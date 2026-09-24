import { operationJobPayloadIssueText, parseOperationJobPayload } from "@geo/content-client"
import { type LLMProvider, sha256Hex } from "@geo/content-pipeline"
import { RollbackError, rollbackRelease, StalePointerEtagError } from "@geo/publisher"
import { AuditActorSchema, CanonicalTimestampSchema } from "@geo/schema/release/v1"

import { workerCredentialOf } from "../config/credentials.js"
import { operationProcessor } from "./operation-processor.js"
import {
  compileAndPlanRelease,
  createWorkerArtifactStore,
  parseWorkerS3Options,
  publishPlannedRelease,
  syncGlobalRoutingManifest,
} from "./release-pipeline.js"
import { type ProcessorContext, TerminalJobError } from "./types.js"

export const terminalPublishErrorOf = (error: unknown): TerminalJobError | null =>
  error instanceof StalePointerEtagError ? new TerminalJobError(error.code, error.message) : null

/**
 * Compile and publish trigger stages exist so the flow topology (and the
 * blocked-on-failure guarantee) is in place today; their real work lands with
 * the compiler and publisher todos, at which point only these two bodies
 * change. A deferred trigger still succeeds on the ledger with the reason
 * recorded, so the timeline shows exactly what ran.
 */
export const createCompileTriggerProcessor = (context: ProcessorContext) =>
  operationProcessor(
    { context },
    {
      stage: "compile-trigger",
      work: async (ctx, job) => {
        const parsed = parseOperationJobPayload(job.data.payload, "publish")
        if (!parsed.success) {
          throw new TerminalJobError(
            "RELEASE_PAYLOAD_INVALID",
            operationJobPayloadIssueText(parsed.error),
          )
        }
        const editionId = parsed.data.editionId
        const planned = await compileAndPlanRelease(context, {
          editionId,
          operationId: job.data.operationId,
          ...(parsed.data.siteId === undefined ? {} : { siteId: parsed.data.siteId }),
        })
        await ctx.client.recordCompileResult(
          editionId,
          {
            manifestSha256: planned.manifestSha256,
            objectCount: planned.objectCount,
            releaseId: planned.releaseId,
            siteId: planned.siteId,
            totalBytes: planned.plan.manifest.objects.reduce(
              (sum, object) => sum + object.bytes,
              0,
            ),
          },
          { operationId: job.data.operationId },
        )
        return {
          kind: "succeeded" as const,
          result: {
            manifestSha256: planned.manifestSha256,
            objectCount: planned.objectCount,
            releaseId: planned.releaseId,
            siteId: planned.siteId,
          },
        }
      },
    },
  )

export const createRollbackGateProcessor = (context: ProcessorContext) =>
  operationProcessor(
    { context },
    {
      stage: "rollback-gate",
      work: async (_ctx, job) => {
        const parsed = parseOperationJobPayload(job.data.payload, "rollback")
        if (!parsed.success) {
          throw new TerminalJobError(
            "ROLLBACK_PAYLOAD_INVALID",
            operationJobPayloadIssueText(parsed.error),
          )
        }
        await context.client.consumeRollbackIntent({
          expectedCurrentManifestSha256: parsed.data.expectedCurrentManifestSha256,
          expectedCurrentReleaseId: parsed.data.expectedCurrentReleaseId,
          expectedManifestSha256: parsed.data.expectedManifestSha256,
          operationId: job.data.operationId,
          rollbackIntentId: parsed.data.rollbackIntentId,
          runtimeSiteId: parsed.data.siteId,
          targetReleaseId: parsed.data.targetReleaseId,
        })
        const store = createWorkerArtifactStore(
          parseWorkerS3Options(process.env, (name) => workerCredentialOf(process.env, name)),
        )
        try {
          const receipt = await rollbackRelease({
            actor: AuditActorSchema.parse({
              actorId: "worker-publisher",
              kind: "service",
            }),
            expectedCurrentManifestSha256: parsed.data.expectedCurrentManifestSha256,
            expectedCurrentReleaseId: parsed.data.expectedCurrentReleaseId,
            expectedManifestSha256: parsed.data.expectedManifestSha256,
            recordedAt: CanonicalTimestampSchema.parse(new Date().toISOString()),
            releaseId: parsed.data.targetReleaseId,
            siteId: parsed.data.siteId,
            store,
          })
          await context.client.recordRollbackReceipt({
            operationId: job.data.operationId,
            receipt: receipt.receipt,
          })
          return { kind: "succeeded" as const, result: { receipt: receipt.receipt } }
        } catch (error) {
          if (error instanceof RollbackError || error instanceof StalePointerEtagError) {
            throw new TerminalJobError(error.code, error.message)
          }
          throw error
        }
      },
    },
  )

export const createPublishGateProcessor = (context: ProcessorContext) =>
  operationProcessor(
    { context },
    {
      stage: "publish-gate",
      work: async (_ctx, job) => {
        const parsed = parseOperationJobPayload(job.data.payload, "publish")
        if (!parsed.success) {
          throw new TerminalJobError(
            "RELEASE_PAYLOAD_INVALID",
            operationJobPayloadIssueText(parsed.error),
          )
        }
        const editionId = parsed.data.editionId
        const planned = await compileAndPlanRelease(context, {
          editionId,
          operationId: job.data.operationId,
          ...(parsed.data.siteId === undefined ? {} : { siteId: parsed.data.siteId }),
        })
        await context.client.recordCompileResult(
          editionId,
          {
            manifestSha256: planned.manifestSha256,
            objectCount: planned.objectCount,
            releaseId: planned.releaseId,
            siteId: planned.siteId,
            totalBytes: planned.plan.manifest.objects.reduce(
              (sum, object) => sum + object.bytes,
              0,
            ),
          },
          { operationId: job.data.operationId },
        )
        const store = createWorkerArtifactStore(
          parseWorkerS3Options(process.env, (name) => workerCredentialOf(process.env, name)),
        )
        try {
          const receipt = await publishPlannedRelease(context, {
            editionId,
            operationId: job.data.operationId,
            planned,
            siteId: planned.siteId,
            store,
          })
          // 按站发布成功后，以数据库为事实源重写全局 routing manifest 与指针；
          // 内容派生 routingId 使同一发布站点集合的重复写入幂等（CAS no-op）。
          await syncGlobalRoutingManifest(context)
          return {
            kind: "succeeded" as const,
            result: {
              manifestSha256: receipt.manifestSha256,
              releaseId: receipt.releaseId,
              siteId: planned.siteId,
            },
          }
        } catch (error) {
          const terminal = terminalPublishErrorOf(error)
          if (terminal !== null) {
            throw terminal
          }
          throw error
        }
      },
    },
  )

/**
 * Standalone embedding warm-up: embed title and body of one edition and
 * store both with scoped input hashes; the store is idempotent by canonical
 * key, so re-runs after a crash reuse the persisted rows.
 */
export const createEmbeddingProcessor = (context: ProcessorContext, provider: LLMProvider) =>
  operationProcessor(
    { context },
    {
      stage: "embedding",
      work: async (ctx, job) => {
        const editionId = Number(job.data.payload?.["editionId"])
        if (!Number.isInteger(editionId) || editionId <= 0) {
          throw new TerminalJobError(
            "EMBEDDING_PAYLOAD_INVALID",
            "editionId must be a positive integer",
          )
        }
        const edition = await ctx.client.getEditionInput(editionId)
        // A3 质量检查按站：向量按成员站各落一行（key 含 siteId，幂等），
        // 其他文章的同站去重才能看到"它也发在本站"。无成员站回退单数站点。
        const memberSites =
          edition.sites.length > 0 ? edition.sites : edition.siteId > 0 ? [edition.siteId] : []
        const stored: string[] = []
        for (const [scope, input] of [
          ["title", typeof edition.title === "string" ? edition.title : ""],
          ["content", JSON.stringify(edition.body)],
        ] as const) {
          const embedding = await provider.embed({
            input,
            requestId: `embed-${editionId}-${scope}`,
          })
          for (const siteId of memberSites) {
            await ctx.client.storeEmbedding(editionId, {
              dimension: embedding.dimension,
              inputHash: sha256Hex(`${embedding.modelId}\n${scope}\n${input}`),
              modelId: embedding.modelId,
              scope,
              ...(siteId > 0 ? { siteId } : {}),
              vector: [...embedding.vector],
            })
          }
          stored.push(scope)
        }
        return { kind: "succeeded" as const, result: { editionId, stored } }
      },
    },
  )

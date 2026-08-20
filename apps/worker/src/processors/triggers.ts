import { readFileSync } from "node:fs"

import { sha256Hex, type LLMProvider } from "@geo/content-pipeline"

import { operationProcessor } from "./operation-processor.js"
import {
  compileAndPlanRelease,
  createWorkerArtifactStore,
  parseWorkerS3Options,
  publishPlannedRelease,
} from "./release-pipeline.js"
import { TerminalJobError, type ProcessorContext } from "./types.js"

const editionIdOfJob = (payload: Record<string, unknown> | undefined): number => {
  const raw = payload?.["editionId"]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TerminalJobError("RELEASE_PAYLOAD_INVALID", "editionId must be a positive integer")
  }
  return parsed
}

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
        const editionId = editionIdOfJob(job.data.payload as Record<string, unknown> | undefined)
        const planned = await compileAndPlanRelease(context, {
          editionId,
          operationId: job.data.operationId,
        })
        await ctx.client.recordCompileResult(editionId, {
          manifestSha256: planned.manifestSha256,
          objectCount: planned.objectCount,
          releaseId: planned.releaseId,
          totalBytes: planned.plan.manifest.objects.reduce((sum, object) => sum + object.bytes, 0),
        })
        return {
          kind: "succeeded" as const,
          result: {
            manifestSha256: planned.manifestSha256,
            objectCount: planned.objectCount,
            releaseId: planned.releaseId,
          },
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
        const editionId = editionIdOfJob(job.data.payload as Record<string, unknown> | undefined)
        const planned = await compileAndPlanRelease(context, {
          editionId,
          operationId: job.data.operationId,
        })
        const store = createWorkerArtifactStore(
          parseWorkerS3Options(process.env, (path) => readFileSync(path, "utf8").trim()),
        )
        const receipt = await publishPlannedRelease(context, { editionId, planned, store })
        return {
          kind: "succeeded" as const,
          result: {
            manifestSha256: receipt.manifestSha256,
            releaseId: receipt.releaseId,
          },
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
        const stored: string[] = []
        for (const [scope, input] of [
          ["title", typeof edition.title === "string" ? edition.title : ""],
          ["content", JSON.stringify(edition.body)],
        ] as const) {
          const embedding = await provider.embed({
            input,
            requestId: `embed-${editionId}-${scope}`,
          })
          await ctx.client.storeEmbedding(editionId, {
            dimension: embedding.dimension,
            inputHash: sha256Hex(`${embedding.modelId}\n${scope}\n${input}`),
            modelId: embedding.modelId,
            scope,
            vector: [...embedding.vector],
          })
          stored.push(scope)
        }
        return { kind: "succeeded" as const, result: { editionId, stored } }
      },
    },
  )

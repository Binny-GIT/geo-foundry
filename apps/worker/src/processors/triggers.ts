import { sha256Hex, type LLMProvider } from "@geo/content-pipeline"

import { operationProcessor } from "./operation-processor.js"
import { TerminalJobError, type ProcessorContext } from "./types.js"

const DEFERRED_COMPILE = { kind: "deferred" as const, reason: "COMPILER_PENDING_TODO_25" }
const DEFERRED_PUBLISH = { kind: "deferred" as const, reason: "PUBLISHER_PENDING_TODO_29" }

/**
 * Compile and publish trigger stages exist so the flow topology (and the
 * blocked-on-failure guarantee) is in place today; their real work lands with
 * the compiler and publisher todos, at which point only these two bodies
 * change. A deferred trigger still succeeds on the ledger with the reason
 * recorded, so the timeline shows exactly what ran.
 */
export const createCompileTriggerProcessor = (context: ProcessorContext) =>
  operationProcessor({ context }, { stage: "compile-trigger", work: async () => DEFERRED_COMPILE })

export const createPublishGateProcessor = (context: ProcessorContext) =>
  operationProcessor({ context }, { stage: "publish-gate", work: async () => DEFERRED_PUBLISH })

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

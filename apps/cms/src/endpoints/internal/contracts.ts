import { z } from "zod"

export const INTERNAL_PATHS = {
  compileResults: "/internal/editions/:id/compile-results",
  compileSnapshot: "/internal/sites/:id/compile-snapshot",
  embeddings: "/internal/editions/:id/embeddings",
  input: "/internal/editions/:id/input",
  publishRequests: "/internal/editions/:id/publish-requests",
  consumeRollbackIntent: "/internal/rollback-intents/consume",
  recordPublishedRelease: "/internal/sites/:id/releases/published",
  recordRollbackReceipt: "/internal/releases/rollback-receipt",
  assessments: "/internal/editions/:id/assessments",
  similarity: "/internal/editions/:id/similarity",
  versions: "/internal/editions/:id/versions",
  operationCancel: "/internal/operations/:operationId/cancel",
  operationGet: "/internal/operations/:operationId",
  operationStageComplete: "/internal/operations/:operationId/stages/complete",
  operationStageStart: "/internal/operations/:operationId/stages/start",
  operationSubmit: "/internal/operations/submit",
  operationsNonTerminal: "/internal/operations/non-terminal",
} as const

export const SHA256_PATTERN = /^[0-9a-f]{64}$/
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]{4,128}$/

export const draftVersionBodySchema = z
  .object({
    body: z.array(z.record(z.string(), z.unknown())).min(1).max(500).optional(),
    primaryTopic: z.string().min(1).max(200).optional(),
    secondaryTopics: z.array(z.string().min(1).max(200)).max(20).optional(),
    summary: z.string().min(1).max(2000).optional(),
    title: z.string().min(1).max(300).optional(),
  })
  .strict()

export const assessmentBodySchema = z
  .object({
    inputHash: z.string().regex(SHA256_PATTERN),
    issues: z
      .array(
        z
          .object({ code: z.string().min(1).max(200), severity: z.string().min(1).max(50) })
          .strict(),
      )
      .max(200),
    modelId: z.string().min(1).max(200),
    overall: z.number().min(0).max(100).optional(),
    dimensions: z.record(z.string().min(1).max(100), z.number()).optional(),
    promptVersion: z.string().min(1).max(100),
    provider: z.string().min(1).max(100),
    state: z.enum(["error", "failed", "passed"]),
    thresholdsHash: z.string().regex(SHA256_PATTERN),
  })
  .strict()

export const compileResultBodySchema = z
  .object({
    manifestSha256: z.string().regex(SHA256_PATTERN),
    objectCount: z.number().int().min(1).max(100_000),
    releaseId: z.string().regex(RELEASE_ID_PATTERN),
    totalBytes: z.number().int().min(0).max(10_000_000_000),
  })
  .strict()

export const publishRequestBodySchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()

export const consumeRollbackIntentBodySchema = z
  .object({
    expectedCurrentManifestSha256: z.string().regex(SHA256_PATTERN),
    expectedCurrentReleaseId: z.string().regex(RELEASE_ID_PATTERN),
    expectedManifestSha256: z.string().regex(SHA256_PATTERN),
    operationId: z.string().regex(OPERATION_ID_PATTERN),
    rollbackIntentId: z.string().uuid(),
    runtimeSiteId: z.string().regex(/^site-\d+$/),
    targetReleaseId: z.string().regex(RELEASE_ID_PATTERN),
  })
  .strict()

export const releaseReceiptBodySchema = z
  .object({
    operationId: z.string().regex(OPERATION_ID_PATTERN),
    receipt: z.record(z.string(), z.unknown()),
  })
  .strict()

export type ConsumeRollbackIntentBody = z.infer<typeof consumeRollbackIntentBodySchema>
export type DraftVersionBody = z.infer<typeof draftVersionBodySchema>
export type AssessmentBody = z.infer<typeof assessmentBodySchema>
export type CompileResultBody = z.infer<typeof compileResultBodySchema>
export type PublishRequestBody = z.infer<typeof publishRequestBodySchema>
export type ReleaseReceiptBody = z.infer<typeof releaseReceiptBodySchema>

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/
export const OPERATION_STAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const submitOperationBodySchema = z
  .object({
    endpoint: z.string().min(1).max(200),
    idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_PATTERN),
    operationType: z.enum(["generate", "evaluate", "publish", "rollback"]),
    requestPayload: z.record(z.string(), z.unknown()),
    siteId: z.number().int().positive().optional(),
    targetIds: z.record(z.string().min(1).max(64), z.number().int().positive()).optional(),
  })
  .strict()

export const startOperationStageBodySchema = z
  .object({
    attempt: z.number().int().min(1).max(1000),
    stage: z.string().regex(OPERATION_STAGE_NAME_PATTERN),
  })
  .strict()

export const completeOperationStageBodySchema = z
  .object({
    attempt: z.number().int().min(1).max(1000),
    error: z.record(z.string(), z.unknown()).optional(),
    outcome: z.enum(["failed", "succeeded"]),
    result: z.record(z.string(), z.unknown()).optional(),
    stage: z.string().regex(OPERATION_STAGE_NAME_PATTERN),
  })
  .strict()

export const cancelOperationBodySchema = z
  .object({
    reason: z.string().min(1).max(500),
  })
  .strict()

export type SubmitOperationBody = z.infer<typeof submitOperationBodySchema>
export type StartOperationStageBody = z.infer<typeof startOperationStageBodySchema>
export type CompleteOperationStageBody = z.infer<typeof completeOperationStageBodySchema>
export type CancelOperationBody = z.infer<typeof cancelOperationBodySchema>

const vectorSchema = z.array(z.number().finite()).min(1).max(4096)

export const embeddingStoreBodySchema = z
  .object({
    dimension: z.number().int().min(1).max(4096),
    inputHash: z.string().regex(SHA256_PATTERN),
    modelId: z.string().min(1).max(200),
    scope: z.enum(["content", "title"]),
    vector: vectorSchema,
  })
  .strict()

export const similarityQueryBodySchema = z
  .object({
    comparison: z.enum(["cross-domain", "same-site"]),
    dimension: z.number().int().min(1).max(4096),
    limit: z.number().int().min(1).max(50),
    modelId: z.string().min(1).max(200),
    scope: z.enum(["content", "title"]),
    vector: vectorSchema,
  })
  .strict()

export type EmbeddingStoreBody = z.infer<typeof embeddingStoreBodySchema>
export type SimilarityQueryBody = z.infer<typeof similarityQueryBodySchema>

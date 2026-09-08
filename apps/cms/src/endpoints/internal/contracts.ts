import { z } from "zod"

export const INTERNAL_PATHS = {
  compileResults: "/internal/editions/:id/compile-results",
  compileSnapshot: "/internal/sites/:id/compile-snapshot",
  embeddings: "/internal/editions/:id/embeddings",
  input: "/internal/editions/:id/input",
  intakeFetchComplete: "/internal/intake-items/:id/fetch-complete",
  intakeFetchFailed: "/internal/intake-items/:id/fetch-failed",
  intakeFetchInput: "/internal/intake-items/:id/fetch-input",
  intakeFetchStart: "/internal/intake-items/:id/fetch-start",
  intakeRssEntries: "/internal/intake-items/:id/rss-entries",
  publicationPlansDispatchDue: "/internal/publication-plans/dispatch-due",
  consumeRollbackIntent: "/internal/rollback-intents/consume",
  recordPublishedRelease: "/internal/sites/:id/releases/published",
  recordRollbackReceipt: "/internal/releases/rollback-receipt",
  assessments: "/internal/editions/:id/assessments",
  similarity: "/internal/editions/:id/similarity",
  versions: "/internal/editions/:id/versions",
  operationGet: "/internal/operations/:operationId",
  operationStageComplete: "/internal/operations/:operationId/stages/complete",
  operationStageStart: "/internal/operations/:operationId/stages/start",
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
    editionId: z.number().int().positive().optional(),
    operationId: z.string().regex(OPERATION_ID_PATTERN),
    receipt: z.record(z.string(), z.unknown()),
  })
  .strict()

export type ConsumeRollbackIntentBody = z.infer<typeof consumeRollbackIntentBodySchema>
export type DraftVersionBody = z.infer<typeof draftVersionBodySchema>
export type AssessmentBody = z.infer<typeof assessmentBodySchema>
export type CompileResultBody = z.infer<typeof compileResultBodySchema>
export type ReleaseReceiptBody = z.infer<typeof releaseReceiptBodySchema>

const intakeSnapshotSchema = z
  .object({
    contentHash: z.string().regex(SHA256_PATTERN),
    contentLength: z.number().int().min(0).max(10_000_000),
    contentType: z.string().min(1).max(200),
    storageKey: z.string().min(1).max(1_000),
  })
  .strict()

export const intakeContentBlockBodySchema = z
  .object({
    blockType: z.enum(["heading", "paragraph", "list", "quote", "code", "image"]),
  })
  .passthrough()

export const intakeFetchCompleteBodySchema = z
  .object({
    contentBlocks: z.array(intakeContentBlockBodySchema).max(200).optional(),
    extracted: intakeSnapshotSchema,
    raw: intakeSnapshotSchema,
    summary: z.string().min(1).max(20_000),
    title: z.string().min(1).max(1_000),
  })
  .strict()

export const intakeFetchFailedBodySchema = z
  .object({
    code: z.string().min(1).max(120),
    reason: z.string().min(1).max(500),
  })
  .strict()

export const intakeRssEntriesBodySchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            sourceUrl: z.string().url().max(4_000),
            summary: z.string().min(1).max(20_000).optional(),
            title: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()

export type IntakeFetchCompleteBody = z.infer<typeof intakeFetchCompleteBodySchema>
export type IntakeFetchFailedBody = z.infer<typeof intakeFetchFailedBodySchema>
export type IntakeRssEntriesBody = z.infer<typeof intakeRssEntriesBodySchema>

export const dispatchDuePublicationPlansBodySchema = z
  .object({
    now: z.string().datetime({ offset: true }),
    workerId: z.string().min(1).max(128),
  })
  .strict()

export type DispatchDuePublicationPlansBody = z.infer<typeof dispatchDuePublicationPlansBodySchema>

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/
export const OPERATION_STAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

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

export type StartOperationStageBody = z.infer<typeof startOperationStageBodySchema>
export type CompleteOperationStageBody = z.infer<typeof completeOperationStageBodySchema>

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

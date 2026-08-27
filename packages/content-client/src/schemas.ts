import { z } from "zod"

export const workflowStatusSchema = z.enum([
  "approved",
  "archived",
  "compiled",
  "draft",
  "generating",
  "published",
  "review",
])

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

export const writeDraftVersionRequestSchema = z
  .object({
    body: z.array(z.record(z.string(), z.unknown())).min(1).max(500).optional(),
    primaryTopic: z.string().min(1).max(200).optional(),
    secondaryTopics: z.array(z.string().min(1).max(200)).max(20).optional(),
    summary: z.string().min(1).max(2000).optional(),
    title: z.string().min(1).max(300).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "patch must not be empty" })

export const recordAssessmentRequestSchema = z.object({
  inputHash: sha256Schema,
  issues: z
    .array(z.object({ code: z.string().min(1).max(200), severity: z.string().min(1).max(50) }))
    .max(200),
  modelId: z.string().min(1).max(200),
  overall: z.number().min(0).max(100).optional(),
  dimensions: z.record(z.string().min(1).max(100), z.number()).optional(),
  promptVersion: z.string().min(1).max(100),
  provider: z.string().min(1).max(100),
  state: z.enum(["error", "failed", "passed"]),
  thresholdsHash: sha256Schema,
})

export const recordCompileResultRequestSchema = z.object({
  manifestSha256: sha256Schema,
  objectCount: z.number().int().min(1).max(100_000),
  releaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
  totalBytes: z.number().int().min(0).max(10_000_000_000),
})

export const consumeRollbackIntentRequestSchema = z
  .object({
    expectedCurrentManifestSha256: sha256Schema,
    expectedCurrentReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
    expectedManifestSha256: sha256Schema,
    operationId: z.string().regex(/^[A-Za-z0-9._-]{4,128}$/),
    rollbackIntentId: z.string().uuid(),
    runtimeSiteId: z.string().regex(/^site-\d+$/),
    targetReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
  })
  .strict()

export const consumeRollbackIntentReceiptSchema = z.object({ consumed: z.literal(true) })

export const recordReleaseReceiptRequestSchema = z.object({
  editionId: z.number().int().positive().optional(),
  operationId: z.string().regex(/^[A-Za-z0-9._-]{4,128}$/),
  receipt: z.record(z.string(), z.unknown()),
})

export const recordReleaseReceiptSchema = z.object({ recorded: z.literal(true) })

export const dispatchDuePublicationPlansRequestSchema = z.object({
  now: z.string().datetime({ offset: true }),
  workerId: z.string().min(1).max(128),
})

export const dispatchDuePublicationPlansResponseSchema = z.object({
  plans: z.array(z.object({ operationId: z.string().min(1), planId: z.string().min(1) })),
})

export const intakeClaimReceiptSchema = z.object({ claimed: z.literal(true) })

export const intakeFetchInputSchema = z.object({
  channel: z.enum(["rss", "url"]),
  connectorId: z.number().int().positive().optional(),
  intakeItemId: z.number().int().positive(),
  sourceUrl: z.string().url().max(4_000),
  tenantId: z.number().int().positive(),
})

const intakeSnapshotSchema = z.object({
  contentHash: sha256Schema,
  contentLength: z.number().int().min(0).max(10_000_000),
  contentType: z.string().min(1).max(200),
  storageKey: z.string().min(1).max(1_000),
})

export const completeIntakeFetchRequestSchema = z.object({
  extracted: intakeSnapshotSchema,
  raw: intakeSnapshotSchema,
  summary: z.string().min(1).max(20_000),
  title: z.string().min(1).max(1_000),
})

export const intakeFetchReceiptSchema = z.object({
  intakeItemId: z.number().int().positive(),
  snapshotId: z.number().int().positive(),
})

export const failIntakeFetchRequestSchema = z.object({
  code: z.string().min(1).max(120),
  reason: z.string().min(1).max(500),
})

export const intakeFailureReceiptSchema = z.object({ failed: z.literal(true) })

export const createRssEntriesRequestSchema = z.object({
  entries: z
    .array(
      z.object({
        sourceUrl: z.string().url().max(4_000),
        summary: z.string().min(1).max(20_000).optional(),
        title: z.string().min(1).max(1_000),
      }),
    )
    .max(20),
})

export const rssEntriesReceiptSchema = z.object({ intakeItemIds: z.array(z.number().int().positive()) })

export const editionInputSchema = z.object({
  compiledRelease: z.string().min(1).nullable(),
  modifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  body: z.unknown(),
  contentId: z.number().int(),
  editionId: z.number().int(),
  inputHash: z.string().length(64),
  primaryTopic: z.unknown(),
  secondaryTopics: z.unknown(),
  siteId: z.number().int(),
  summary: z.unknown(),
  tenantId: z.number().int(),
  title: z.unknown(),
  workflowRevision: z.number().int().min(0),
  workflowStatus: workflowStatusSchema,
})

export const draftWriteReceiptSchema = z.object({
  fields: z.array(z.string().min(1)),
  inputHash: z.string().length(64),
  workflowRevision: z.number().int().min(0),
  workflowStatus: workflowStatusSchema,
})

export const assessmentReceiptSchema = z.object({
  assessmentId: z.number().int().min(1),
})

export const compileResultReceiptSchema = z.object({
  releaseId: z.string().min(1),
  workflowStatus: workflowStatusSchema,
})

export const rollbackRequestSchema = z
  .object({
    expectedCurrentManifestSha256: sha256Schema,
    expectedCurrentReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
    expectedManifestSha256: sha256Schema,
    rollbackIntentId: z.string().uuid(),
    reason: z.string().min(1).max(500).optional(),
    siteId: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
    targetReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
  })
  .strict()

export const operationStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])

export const operationTypeSchema = z.enum(["generate", "evaluate", "publish", "rollback"])

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._-]{8,128}$/)

export const compileSnapshotSchema = z.object({
  editions: z.array(z.record(z.string(), z.unknown())),
  listings: z.record(z.string(), z.unknown()),
  notFound: z.object({ pathname: z.string().min(1).startsWith("/") }),
  redirects: z.array(
    z.object({
      fromPathname: z.string().min(1).startsWith("/"),
      targetUrl: z.string().min(1),
    }),
  ),
  site: z.record(z.string(), z.unknown()),
})

export const operationSnapshotSchema = z.object({
  attempt: z.number().int().min(1),
  currentStage: z.string().min(1).nullable(),
  endpoint: z.string().min(1),
  error: z.record(z.string(), z.unknown()).nullable(),
  operationId: z.string().min(1),
  operationType: operationTypeSchema,
  requestPayload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  state: operationStateSchema,
  tenantId: z.number().int(),
})

export const submitOperationRequestSchema = z
  .object({
    endpoint: z.string().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
    operationType: operationTypeSchema,
    requestPayload: z.record(z.string(), z.unknown()),
    siteId: z.number().int().positive().optional(),
    targetIds: z.record(z.string().min(1).max(64), z.number().int().positive()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const startOperationStageRequestSchema = z.object({
  attempt: z.number().int().min(1).max(1000),
  stage: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
})

export const completeOperationStageRequestSchema = z
  .object({
    attempt: z.number().int().min(1).max(1000),
    error: z.record(z.string(), z.unknown()).optional(),
    outcome: z.enum(["failed", "succeeded"]),
    result: z.record(z.string(), z.unknown()).optional(),
    stage: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  })
  .refine((value) => value.outcome !== "succeeded" || value.result !== undefined)
  .refine((value) => value.outcome !== "failed" || value.error !== undefined)

export const cancelOperationRequestSchema = z.object({
  reason: z.string().min(1).max(500),
})

export const submitOperationResponseSchema = z.object({
  created: z.boolean(),
  operation: operationSnapshotSchema,
})

export const operationResponseSchema = z.object({
  operation: operationSnapshotSchema,
})

export const nonTerminalOperationsResponseSchema = z.object({
  operations: z.array(operationSnapshotSchema),
})

export const embeddingScopeSchema = z.enum(["content", "title"])

export const semanticComparisonSchema = z.enum(["cross-domain", "same-site"])

export const storeEmbeddingRequestSchema = z.object({
  dimension: z.number().int().min(1).max(4096),
  inputHash: sha256Schema,
  modelId: z.string().min(1).max(200),
  scope: embeddingScopeSchema,
  vector: z.array(z.number().finite()).min(1).max(4096),
})

export const embeddingReceiptSchema = z.object({
  created: z.boolean(),
  embeddingId: z.number().int().min(1),
  embeddingKey: z.string().min(1).max(200),
})

export const similarityQueryRequestSchema = z.object({
  comparison: semanticComparisonSchema,
  dimension: z.number().int().min(1).max(4096),
  limit: z.number().int().min(1).max(50),
  modelId: z.string().min(1).max(200),
  scope: embeddingScopeSchema,
  vector: z.array(z.number().finite()).min(1).max(4096),
})

export const similarityMatchSchema = z.object({
  editionId: z.number().int().min(1),
  inputHash: sha256Schema,
  siteId: z.number().int().min(1),
  similarity: z.number().finite().min(-1).max(1),
  title: z.string().min(1).max(300).nullable(),
})

export const similarityResponseSchema = z.object({
  matches: z.array(similarityMatchSchema).max(50),
})

export const internalErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    issues: z.array(z.object({ message: z.string(), path: z.array(z.string()) })).optional(),
    message: z.string().optional(),
    requestId: z.string().min(1),
  }),
})

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>
export type WriteDraftVersionRequest = z.input<typeof writeDraftVersionRequestSchema>
export type RecordAssessmentRequest = z.input<typeof recordAssessmentRequestSchema>
export type RecordCompileResultRequest = z.input<typeof recordCompileResultRequestSchema>
export type ConsumeRollbackIntentRequest = z.input<typeof consumeRollbackIntentRequestSchema>
export type RecordReleaseReceiptRequest = z.input<typeof recordReleaseReceiptRequestSchema>
export type DispatchDuePublicationPlansRequest = z.input<typeof dispatchDuePublicationPlansRequestSchema>
export type IntakeFetchInput = z.infer<typeof intakeFetchInputSchema>
export type CompleteIntakeFetchRequest = z.input<typeof completeIntakeFetchRequestSchema>
export type FailIntakeFetchRequest = z.input<typeof failIntakeFetchRequestSchema>
export type CreateRssEntriesRequest = z.input<typeof createRssEntriesRequestSchema>
export type EditionInput = z.infer<typeof editionInputSchema>
export type CompileSnapshot = z.infer<typeof compileSnapshotSchema>
export type DraftWriteReceipt = z.infer<typeof draftWriteReceiptSchema>
export type AssessmentReceipt = z.infer<typeof assessmentReceiptSchema>
export type CompileResultReceipt = z.infer<typeof compileResultReceiptSchema>
export type RollbackRequest = z.input<typeof rollbackRequestSchema>
export type OperationState = z.infer<typeof operationStateSchema>
export type OperationType = z.infer<typeof operationTypeSchema>
export type OperationSnapshot = z.infer<typeof operationSnapshotSchema>
export type SubmitOperationRequest = z.input<typeof submitOperationRequestSchema>
export type StartOperationStageRequest = z.input<typeof startOperationStageRequestSchema>
export type CompleteOperationStageRequest = z.input<typeof completeOperationStageRequestSchema>
export type CancelOperationRequest = z.input<typeof cancelOperationRequestSchema>
export type EmbeddingScope = z.infer<typeof embeddingScopeSchema>
export type SemanticComparison = z.infer<typeof semanticComparisonSchema>
export type StoreEmbeddingRequest = z.input<typeof storeEmbeddingRequestSchema>
export type EmbeddingReceipt = z.infer<typeof embeddingReceiptSchema>
export type SimilarityQueryRequest = z.input<typeof similarityQueryRequestSchema>
export type SimilarityMatch = z.infer<typeof similarityMatchSchema>

const siteStrategySchema = z
  .object({
    locale: z.string().min(2).max(35),
    name: z.string().min(1).max(100),
    tone: z.string().min(1).max(100).optional(),
  })
  .strict()

const briefSourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    snippet: z.string().min(1).max(2000),
    title: z.string().min(1).max(200),
    url: z.string().url().max(2000).optional(),
  })
  .strict()

export const generateRequestSchema = z
  .object({
    brief: z
      .object({
        constraints: z.array(z.string().min(1).max(300)).max(20).optional(),
        intent: z.string().min(1).max(500),
        sources: z.array(briefSourceSchema).min(1).max(20),
        topic: z.string().min(1).max(300),
      })
      .strict(),
    contentId: z.number().int().positive(),
    targets: z
      .array(
        z
          .object({
            angle: z.string().min(1).max(200),
            editionId: z.number().int().positive(),
            siteStrategy: siteStrategySchema,
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict()

export const evaluateRequestSchema = z
  .object({
    editionId: z.number().int().positive(),
    thresholds: z
      .object({
        dimensionMin: z.number().min(0).max(100),
        overallMin: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict()

export type GenerateRequest = z.input<typeof generateRequestSchema>
export type EvaluateRequest = z.input<typeof evaluateRequestSchema>

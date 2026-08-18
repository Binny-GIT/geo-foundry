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

export const requestPublishRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
})

export const editionInputSchema = z.object({
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

export const publishRequestReceiptSchema = compileResultReceiptSchema

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
export type RequestPublishRequest = z.input<typeof requestPublishRequestSchema>
export type EditionInput = z.infer<typeof editionInputSchema>
export type DraftWriteReceipt = z.infer<typeof draftWriteReceiptSchema>
export type AssessmentReceipt = z.infer<typeof assessmentReceiptSchema>
export type CompileResultReceipt = z.infer<typeof compileResultReceiptSchema>
export type PublishRequestReceipt = z.infer<typeof publishRequestReceiptSchema>

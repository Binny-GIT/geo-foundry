import { z } from "zod"

export const INTERNAL_PATHS = {
  compileResults: "/internal/editions/:id/compile-results",
  input: "/internal/editions/:id/input",
  publishRequests: "/internal/editions/:id/publish-requests",
  assessments: "/internal/editions/:id/assessments",
  versions: "/internal/editions/:id/versions",
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

export type DraftVersionBody = z.infer<typeof draftVersionBodySchema>
export type AssessmentBody = z.infer<typeof assessmentBodySchema>
export type CompileResultBody = z.infer<typeof compileResultBodySchema>
export type PublishRequestBody = z.infer<typeof publishRequestBodySchema>

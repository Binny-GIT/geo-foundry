import { z } from "zod"

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]{4,128}$/
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/

export const CONTENT_SERVICE_ERROR_CODE = {
  BODY_INVALID: "CONTENT_SERVICE_BODY_INVALID",
  BODY_TOO_LARGE: "CONTENT_SERVICE_BODY_TOO_LARGE",
  IDEMPOTENCY_KEY_REQUIRED: "CONTENT_SERVICE_IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_INVALID: "CONTENT_SERVICE_IDEMPOTENCY_KEY_INVALID",
  NOT_FOUND: "CONTENT_SERVICE_NOT_FOUND",
  UNAUTHENTICATED: "CONTENT_SERVICE_UNAUTHENTICATED",
  UPSTREAM: "CONTENT_SERVICE_UPSTREAM",
} as const

const siteStrategySchema = z
  .object({
    locale: z.string().min(2).max(35),
    name: z.string().min(1).max(100),
    tone: z.string().min(1).max(100).optional(),
  })
  .strict()

const sourceSchema = z
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
        sources: z.array(sourceSchema).min(1).max(20),
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

export type GenerateRequest = z.infer<typeof generateRequestSchema>
export type EvaluateRequest = z.infer<typeof evaluateRequestSchema>

export const ENDPOINT = {
  evaluate: "/v1/evaluate",
  generate: "/v1/generate",
} as const

import {
  evaluateRequestSchema as clientEvaluateRequestSchema,
  generateRequestSchema as clientGenerateRequestSchema,
  publishRequestSchema as clientPublishRequestSchema,
  rollbackRequestSchema as clientRollbackRequestSchema,
} from "@geo/content-client"

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

export const generateRequestSchema = clientGenerateRequestSchema
export const evaluateRequestSchema = clientEvaluateRequestSchema
export const publishRequestSchema = clientPublishRequestSchema
export const rollbackRequestSchema = clientRollbackRequestSchema

export const ENDPOINT = {
  evaluate: "/v1/evaluate",
  generate: "/v1/generate",
  publish: "/v1/publish",
  rollback: "/v1/rollback",
} as const

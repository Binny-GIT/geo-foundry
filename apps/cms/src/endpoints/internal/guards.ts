import type { PayloadHandler, PayloadRequest } from "payload"
import type { ZodType } from "zod"

import { resolveSessionClaims, type SessionClaims } from "../../access/session"
import { EditionWorkflowError } from "../../services/edition-workflow"
import { EmbeddingStoreError } from "../../services/embedding-store"
import { OperationsLedgerError } from "../../services/operations-ledger"
import { ReleaseRegistryError } from "../../services/release-registry"
import { RollbackIntentError } from "../../services/rollback-intents"
import { OPERATION_ID_PATTERN, REQUEST_ID_PATTERN } from "./contracts"

export const INTERNAL_ERROR_CODE = {
  BODY_INVALID: "INTERNAL_BODY_INVALID",
  BODY_TOO_LARGE: "INTERNAL_BODY_TOO_LARGE",
  FORBIDDEN: "INTERNAL_FORBIDDEN",
  INTERNAL: "INTERNAL_ERROR",
  OPERATION_ID_INVALID: "INTERNAL_OPERATION_ID_INVALID",
  RATE_LIMITED: "INTERNAL_RATE_LIMITED",
  REQUEST_ID_INVALID: "INTERNAL_REQUEST_ID_INVALID",
  UNAUTHENTICATED: "INTERNAL_UNAUTHENTICATED",
} as const

const RATE_WINDOW_MS = 60_000

export type InternalEndpointConfig = {
  readonly allowedOrigins: ReadonlySet<string>
  readonly maxBodyBytes: number
  readonly rateLimitPerMinute: number
}

const positiveIntOrDefault = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const parseInternalEndpointConfig = (
  env: Record<string, string | undefined>,
): InternalEndpointConfig => ({
  allowedOrigins: new Set(
    (env["CMS_INTERNAL_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  ),
  maxBodyBytes: positiveIntOrDefault(env["CMS_INTERNAL_MAX_BODY_BYTES"], 1_048_576),
  rateLimitPerMinute: positiveIntOrDefault(env["CMS_INTERNAL_RATE_LIMIT_PER_MINUTE"], 600),
})

let guardConfig: InternalEndpointConfig | null = null

export const currentInternalEndpointConfig = (): InternalEndpointConfig =>
  (guardConfig ??= parseInternalEndpointConfig(process.env))

export const configureInternalGuards = (config: InternalEndpointConfig): void => {
  guardConfig = config
}

type RateWindow = { count: number; expiresAt: number }

const rateWindows = new Map<string, RateWindow>()

export const resetInternalGuardsForTests = (): void => {
  rateWindows.clear()
  guardConfig = null
}

const consumeRateLimit = (key: string, limit: number): boolean => {
  const now = Date.now()
  const window = rateWindows.get(key)
  if (window === undefined || window.expiresAt <= now) {
    rateWindows.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS })
    return true
  }
  if (window.count >= limit) {
    return false
  }
  window.count += 1
  return true
}

const corsAllowOriginOf = (config: InternalEndpointConfig, req: PayloadRequest): string | null => {
  const origin = req.headers?.get("origin")
  if (origin === null || origin === undefined || origin.length === 0) {
    return null
  }
  return config.allowedOrigins.has(origin) ? origin : null
}

const baseHeaders = (requestId: string, allowOrigin: string | null): Headers => {
  const headers = new Headers({ vary: "Origin", "x-request-id": requestId })
  if (allowOrigin !== null) {
    headers.set("access-control-allow-origin", allowOrigin)
  }
  return headers
}

export const internalJsonResponse = (
  status: number,
  body: unknown,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  const headers = baseHeaders(requestId, allowOrigin)
  headers.set("content-type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(body), { headers, status })
}

const errorBodyOf = (code: string, message: string, requestId: string) => ({
  error: { code, message, requestId },
})

export const internalErrorResponse = (
  status: number,
  code: string,
  message: string,
  requestId: string,
  allowOrigin: string | null,
): Response =>
  internalJsonResponse(status, errorBodyOf(code, message, requestId), requestId, allowOrigin)

const WORKFLOW_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  CONTENT_EDITION_EDITOR_REQUIRED: 403,
  CONTENT_EDITION_PUBLISHER_REQUIRED: 403,
  CONTENT_EDITION_REVIEWER_REQUIRED: 403,
  CONTENT_EDITION_SOURCE_NOT_PUBLISHED: 409,
  CONTENT_EDITION_TRANSITION_NOT_ALLOWED: 409,
  EDITION_PATCH_EMPTY: 400,
  EDITION_WORKFLOW_ACTOR_INVALID: 401,
  EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED: 409,
  EDITION_WORKFLOW_ASSESSMENT_REQUIRED: 409,
  EDITION_WORKFLOW_CLOCK_INVALID: 500,
  EDITION_WORKFLOW_NOT_APPROVED: 409,
  EDITION_WORKFLOW_NOT_COMPILED: 409,
  EDITION_WORKFLOW_NOT_FOUND: 404,
  EDITION_WORKFLOW_NOT_WRITABLE: 409,
  EDITION_WORKFLOW_RELEASE_REQUIRED: 409,
  EDITION_WORKFLOW_REVISION_CONFLICT: 409,
  EDITION_WORKFLOW_ROW_INVALID: 400,
  EDITION_WORKFLOW_SERVICE_REQUIRED: 403,
  EDITION_WORKFLOW_STALE_ASSESSMENT: 409,
  EDITION_WORKFLOW_STATE_INVALID: 409,
  EDITION_WORKFLOW_TENANT_MISMATCH: 403,
}

const workflowErrorToResponse = (
  error: EditionWorkflowError,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  if (
    error.code === "EDITION_WORKFLOW_NOT_FOUND" ||
    error.code === "EDITION_WORKFLOW_TENANT_MISMATCH" ||
    error.code === "COMPILE_SNAPSHOT_SITE_MISSING" ||
    error.code === "COMPILE_SNAPSHOT_TENANT_MISMATCH"
  ) {
    const edition = error.code.startsWith("EDITION_")
    return internalErrorResponse(
      404,
      edition ? "EDITION_WORKFLOW_NOT_FOUND" : "COMPILE_SNAPSHOT_SITE_MISSING",
      edition ? "edition not found" : "site not found",
      requestId,
      allowOrigin,
    )
  }
  const status = WORKFLOW_STATUS_BY_CODE[error.code] ?? 500
  return internalErrorResponse(
    status,
    error.code,
    error.detail ?? error.code,
    requestId,
    allowOrigin,
  )
}

const LEDGER_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  IDEMPOTENCY_KEY_REUSED: 409,
  OPERATION_ATTEMPT_STALE: 409,
  OPERATION_CLOCK_INVALID: 500,
  OPERATION_NOT_FOUND: 404,
  OPERATION_REVISION_CONFLICT: 409,
  OPERATION_RETRY_SOURCE_NOT_FAILED: 409,
  OPERATION_STAGE_INVALID: 400,
  OPERATION_STATE_INVALID: 400,
  OPERATION_TENANT_MISMATCH: 403,
  OPERATION_TRANSITION_NOT_ALLOWED: 409,
  OPERATIONS_INPUT_INVALID: 400,
}

const ledgerErrorToResponse = (
  error: OperationsLedgerError,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  if (error.code === "OPERATION_NOT_FOUND" || error.code === "OPERATION_TENANT_MISMATCH") {
    return internalErrorResponse(
      404,
      "OPERATION_NOT_FOUND",
      "operation not found",
      requestId,
      allowOrigin,
    )
  }
  const status = LEDGER_STATUS_BY_CODE[error.code] ?? 500
  return internalErrorResponse(
    status,
    error.code,
    error.detail ?? error.code,
    requestId,
    allowOrigin,
  )
}

const ROLLBACK_INTENT_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  ROLLBACK_INTENT_ALREADY_CONSUMED: 409,
  ROLLBACK_INTENT_MISMATCH: 409,
  ROLLBACK_INTENT_NOT_FOUND: 404,
  ROLLBACK_INTENT_SERVICE_REQUIRED: 403,
}

const rollbackIntentErrorToResponse = (
  error: RollbackIntentError,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  const status = ROLLBACK_INTENT_STATUS_BY_CODE[error.code] ?? 500
  return internalErrorResponse(status, error.code, error.message, requestId, allowOrigin)
}

const RELEASE_REGISTRY_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  RELEASE_IDENTITY_CONFLICT: 409,
  RELEASE_RECONCILIATION_REQUIRED: 409,
  RELEASE_REVISION_CONFLICT: 409,
  RELEASE_RUNTIME_SITE_INVALID: 400,
  RELEASE_SITE_MISMATCH: 409,
  RELEASE_SITE_NOT_FOUND: 404,
  RELEASE_SOURCE_IDENTITY_CONFLICT: 409,
  RELEASE_TENANT_MISMATCH: 403,
}

const releaseRegistryErrorToResponse = (
  error: ReleaseRegistryError,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  if (error.code === "RELEASE_SITE_NOT_FOUND" || error.code === "RELEASE_TENANT_MISMATCH") {
    return internalErrorResponse(
      404,
      "RELEASE_SITE_NOT_FOUND",
      "site not found",
      requestId,
      allowOrigin,
    )
  }
  return internalErrorResponse(
    RELEASE_REGISTRY_STATUS_BY_CODE[error.code] ?? 500,
    error.code,
    error.message,
    requestId,
    allowOrigin,
  )
}

const EMBEDDING_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  EMBEDDING_DIMENSION_MISMATCH: 400,
  EMBEDDING_EDITION_NOT_FOUND: 404,
  EMBEDDING_STORE_UNAVAILABLE: 500,
  EMBEDDING_TENANT_MISMATCH: 403,
  EMBEDDING_VECTOR_INVALID: 400,
}

const embeddingErrorToResponse = (
  error: EmbeddingStoreError,
  requestId: string,
  allowOrigin: string | null,
): Response => {
  const status = EMBEDDING_STATUS_BY_CODE[error.code] ?? 500
  return internalErrorResponse(
    status,
    error.code,
    error.detail ?? error.code,
    requestId,
    allowOrigin,
  )
}

const readRawBody = async (req: PayloadRequest): Promise<string> => {
  if (typeof req.text === "function") {
    return await req.text()
  }
  if (typeof req.json === "function") {
    return JSON.stringify(await req.json())
  }
  return ""
}

export type InternalHandlerContext = {
  readonly claims: SessionClaims
  readonly operation: string
  readonly operationId: string | null
  readonly requestId: string
}

export type GuardedHandler<TBody> = (
  req: PayloadRequest,
  ctx: InternalHandlerContext,
  body: TBody,
) => Promise<Response> | Response

export type GuardOptions<TBody> = {
  readonly bodySchema: ZodType<TBody> | null
  readonly operation: string
}

/**
 * Zero-trust request guard for the internal integration surface:
 * deny-by-default service auth, strict tenant binding, request-id
 * correlation, explicit CORS allow-list, per-identity rate limits, and a
 * byte-capped JSON body whose schema is validated before any handler runs.
 * Responses never leak stack traces, environment values, or internal errors.
 */
export const withInternalGuards =
  <TBody>(options: GuardOptions<TBody>, handler: GuardedHandler<TBody>): PayloadHandler =>
  async (req) => {
    const config = currentInternalEndpointConfig()
    const allowOrigin = corsAllowOriginOf(config, req)
    const method = (req.method ?? "GET").toUpperCase()
    const headerRequestId = req.headers?.get("x-request-id") ?? null
    const requestId =
      headerRequestId === null
        ? crypto.randomUUID()
        : REQUEST_ID_PATTERN.test(headerRequestId)
          ? headerRequestId
          : null
    if (requestId === null) {
      return internalErrorResponse(
        400,
        INTERNAL_ERROR_CODE.REQUEST_ID_INVALID,
        "x-request-id must match [A-Za-z0-9._-]{8,64}",
        headerRequestId ?? crypto.randomUUID(),
        allowOrigin,
      )
    }

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseHeaders(requestId, allowOrigin) })
    }

    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return internalErrorResponse(
        401,
        INTERNAL_ERROR_CODE.UNAUTHENTICATED,
        "a valid service identity is required",
        requestId,
        allowOrigin,
      )
    }
    if (claims.kind !== "service" || claims.role !== "content-service") {
      return internalErrorResponse(
        403,
        INTERNAL_ERROR_CODE.FORBIDDEN,
        "only the content-service identity may call internal endpoints",
        requestId,
        allowOrigin,
      )
    }

    if (!consumeRateLimit(`${claims.userId}:${options.operation}`, config.rateLimitPerMinute)) {
      const retryAfter = Math.ceil(RATE_WINDOW_MS / 1000)
      const headers = baseHeaders(requestId, allowOrigin)
      headers.set("content-type", "application/json; charset=utf-8")
      headers.set("retry-after", String(retryAfter))
      return new Response(
        JSON.stringify(
          errorBodyOf(INTERNAL_ERROR_CODE.RATE_LIMITED, "rate limit exceeded", requestId),
        ),
        { headers, status: 429 },
      )
    }

    const headerOperationId = req.headers?.get("x-operation-id") ?? null
    if (headerOperationId !== null && !OPERATION_ID_PATTERN.test(headerOperationId)) {
      return internalErrorResponse(
        400,
        INTERNAL_ERROR_CODE.OPERATION_ID_INVALID,
        "x-operation-id must match [A-Za-z0-9._-]{4,128}",
        requestId,
        allowOrigin,
      )
    }

    let body: TBody
    if (options.bodySchema === null) {
      body = undefined as TBody
    } else {
      const declaredLength = Number(req.headers?.get("content-length") ?? "0")
      if (Number.isFinite(declaredLength) && declaredLength > config.maxBodyBytes) {
        return internalErrorResponse(
          413,
          INTERNAL_ERROR_CODE.BODY_TOO_LARGE,
          `body exceeds ${config.maxBodyBytes} bytes`,
          requestId,
          allowOrigin,
        )
      }
      let raw: string
      try {
        raw = await readRawBody(req)
      } catch {
        return internalErrorResponse(
          400,
          INTERNAL_ERROR_CODE.BODY_INVALID,
          "request body could not be read",
          requestId,
          allowOrigin,
        )
      }
      if (raw.length > config.maxBodyBytes) {
        return internalErrorResponse(
          413,
          INTERNAL_ERROR_CODE.BODY_TOO_LARGE,
          `body exceeds ${config.maxBodyBytes} bytes`,
          requestId,
          allowOrigin,
        )
      }
      let parsed: unknown
      try {
        parsed = raw.length === 0 ? {} : JSON.parse(raw)
      } catch {
        return internalErrorResponse(
          400,
          INTERNAL_ERROR_CODE.BODY_INVALID,
          "request body must be valid JSON",
          requestId,
          allowOrigin,
        )
      }
      const validated = options.bodySchema.safeParse(parsed)
      if (!validated.success) {
        return internalJsonResponse(
          400,
          {
            error: {
              code: INTERNAL_ERROR_CODE.BODY_INVALID,
              issues: validated.error.issues.map((issue) => ({
                message: issue.message,
                path: issue.path.map((segment) => String(segment)),
              })),
              requestId,
            },
          },
          requestId,
          allowOrigin,
        )
      }
      body = validated.data
    }

    try {
      const response = await handler(
        req,
        {
          claims,
          operation: options.operation,
          operationId: headerOperationId,
          requestId,
        },
        body,
      )
      const headers = new Headers(response.headers)
      if (headers.get("x-request-id") === null) {
        headers.set("x-request-id", requestId)
      }
      headers.set("vary", "Origin")
      if (allowOrigin !== null && headers.get("access-control-allow-origin") === null) {
        headers.set("access-control-allow-origin", allowOrigin)
      }
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      })
    } catch (error) {
      if (error instanceof EditionWorkflowError) {
        return workflowErrorToResponse(error, requestId, allowOrigin)
      }
      if (error instanceof OperationsLedgerError) {
        return ledgerErrorToResponse(error, requestId, allowOrigin)
      }
      if (error instanceof RollbackIntentError) {
        return rollbackIntentErrorToResponse(error, requestId, allowOrigin)
      }
      if (error instanceof ReleaseRegistryError) {
        return releaseRegistryErrorToResponse(error, requestId, allowOrigin)
      }
      if (error instanceof EmbeddingStoreError) {
        return embeddingErrorToResponse(error, requestId, allowOrigin)
      }
      return internalErrorResponse(
        500,
        INTERNAL_ERROR_CODE.INTERNAL,
        "internal error",
        requestId,
        allowOrigin,
      )
    }
  }

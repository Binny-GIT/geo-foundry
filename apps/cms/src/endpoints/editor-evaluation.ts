import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { EditionWorkflowError } from "../services/edition-workflow"
import {
  OperationsLedgerError,
  submitEditionEvaluationOperation,
} from "../services/operations-ledger"
import { IDEMPOTENCY_KEY_PATTERN, REQUEST_ID_PATTERN } from "./internal/contracts"

const bodySchema = z
  .object({
    thresholds: z
      .object({
        dimensionMin: z.number().min(0).max(100),
        overallMin: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict()

const editionIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const requestIdOf = (req: PayloadRequest): string | null => {
  const supplied = req.headers?.get("x-request-id") ?? null
  if (supplied === null) return crypto.randomUUID()
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : null
}

const idempotencyKeyOf = (req: PayloadRequest): string | null => {
  const supplied = req.headers?.get("idempotency-key") ?? null
  return supplied !== null && IDEMPOTENCY_KEY_PATTERN.test(supplied) ? supplied : null
}

const response = (status: number, body: unknown, requestId?: string): Response => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" })
  if (requestId !== undefined) headers.set("x-request-id", requestId)
  return new Response(JSON.stringify(body), { headers, status })
}

const notFound = (requestId: string): Response =>
  response(404, { error: { code: "EDITOR_EVALUATION_NOT_FOUND" } }, requestId)

const errorResponseOf = (error: unknown, requestId: string): Response => {
  if (error instanceof EditionWorkflowError) {
    if (
      error.code === "EDITION_WORKFLOW_NOT_FOUND" ||
      error.code === "EDITION_WORKFLOW_TENANT_MISMATCH"
    ) {
      return notFound(requestId)
    }
    if (error.code === "EDITION_WORKFLOW_EDITOR_REQUIRED") {
      return response(403, { error: { code: error.code } }, requestId)
    }
    if (error.code === "EDITION_WORKFLOW_EVALUATION_NOT_ALLOWED") {
      return response(409, { error: { code: error.code } }, requestId)
    }
    return response(400, { error: { code: error.code } }, requestId)
  }
  if (error instanceof OperationsLedgerError) {
    return response(error.code === "IDEMPOTENCY_KEY_REUSED" ? 409 : 400, { error: { code: error.code } }, requestId)
  }
  throw error
}

/** Editor-authorized evaluation intent; execution and assessment persistence remain service-only. */
export const submitEditorEvaluationEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) return response(400, { error: { code: "EDITOR_EVALUATION_ID_INVALID" } })
    const requestId = requestIdOf(req)
    if (requestId === null) {
      return response(400, { error: { code: "EDITOR_EVALUATION_REQUEST_ID_INVALID" } })
    }
    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return response(401, { error: { code: "EDITOR_EVALUATION_UNAUTHENTICATED" } }, requestId)
    }
    if (claims.kind !== "user" || claims.role !== "editor") {
      return response(403, { error: { code: "EDITION_WORKFLOW_EDITOR_REQUIRED" } }, requestId)
    }
    const idempotencyKey = idempotencyKeyOf(req)
    if (idempotencyKey === null) {
      return response(400, { error: { code: "EDITOR_EVALUATION_IDEMPOTENCY_KEY_INVALID" } }, requestId)
    }
    let body: unknown
    try {
      body = (await req.json?.()) ?? {}
    } catch {
      return response(400, { error: { code: "EDITOR_EVALUATION_BODY_INVALID" } }, requestId)
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "EDITOR_EVALUATION_BODY_INVALID" } }, requestId)
    }
    try {
      const outcome = await submitEditionEvaluationOperation(req.payload, {
        editionId,
        idempotencyKey,
        requestId,
        ...(parsed.data.thresholds === undefined ? {} : { thresholds: parsed.data.thresholds }),
        user: req.user,
      })
      return response(outcome.created ? 202 : 200, { editionId, ...outcome }, requestId)
    } catch (error) {
      return errorResponseOf(error, requestId)
    }
  },
  method: "post",
  path: "/workspaces/editor/editions/:id/evaluation-operations",
}

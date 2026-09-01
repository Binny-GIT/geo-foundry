import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { EditionWorkflowError } from "../services/edition-workflow"
import {
  type ReviewerDecisionTarget,
  ReviewerEditionDecisionError,
  submitReviewerEditionDecision,
} from "../services/reviewer-edition-decisions"
import { IDEMPOTENCY_KEY_PATTERN, REQUEST_ID_PATTERN } from "./internal/contracts"

const expectedRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const reasonSchema = z.string().trim().min(1).max(500)

const approveBodySchema = z.object({ expectedRevision: expectedRevisionSchema }).strict()

const requestChangesBodySchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
    reason: reasonSchema,
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
  response(
    404,
    { error: { code: "REVIEWER_EDITION_NOT_FOUND", message: "edition not found" } },
    requestId,
  )

const errorResponseOf = (error: unknown, requestId: string): Response => {
  if (error instanceof ReviewerEditionDecisionError) {
    if (error.code === "IDEMPOTENCY_KEY_REUSED") {
      return response(409, { error: { code: error.code } }, requestId)
    }
    if (error.code === "REVIEWER_EDITION_REVIEWER_REQUIRED") {
      return response(403, { error: { code: error.code } }, requestId)
    }
    return response(400, { error: { code: error.code } }, requestId)
  }
  if (error instanceof EditionWorkflowError) {
    if (
      error.code === "EDITION_WORKFLOW_NOT_FOUND" ||
      error.code === "EDITION_WORKFLOW_TENANT_MISMATCH"
    ) {
      return notFound(requestId)
    }
    if (
      error.code === "EDITION_WORKFLOW_REVISION_CONFLICT" ||
      error.code === "EDITION_WORKFLOW_SOURCE_REQUIRED" ||
      error.code === "EDITION_WORKFLOW_ASSESSMENT_REQUIRED" ||
      error.code === "EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED" ||
      error.code === "EDITION_WORKFLOW_STALE_ASSESSMENT" ||
      error.code === "CONTENT_EDITION_TRANSITION_NOT_ALLOWED"
    ) {
      return response(409, { error: { code: error.code } }, requestId)
    }
    return response(400, { error: { code: error.code } }, requestId)
  }
  throw error
}

const reviewerEndpoint = (
  target: ReviewerDecisionTarget,
  parseBody: (body: unknown) =>
    | {
        readonly success: true
        readonly data: { readonly expectedRevision: number; readonly reason?: string }
      }
    | { readonly success: false },
): Endpoint => ({
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) {
      return response(400, { error: { code: "REVIEWER_EDITION_ID_INVALID" } })
    }
    const requestId = requestIdOf(req)
    if (requestId === null) {
      return response(400, { error: { code: "REVIEWER_EDITION_REQUEST_ID_INVALID" } })
    }
    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return response(401, { error: { code: "REVIEWER_EDITION_UNAUTHENTICATED" } }, requestId)
    }
    if (claims.kind !== "user" || claims.role !== "reviewer") {
      return response(403, { error: { code: "REVIEWER_EDITION_REVIEWER_REQUIRED" } }, requestId)
    }
    const idempotencyKey = idempotencyKeyOf(req)
    if (idempotencyKey === null) {
      return response(
        400,
        { error: { code: "REVIEWER_EDITION_IDEMPOTENCY_KEY_INVALID" } },
        requestId,
      )
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "REVIEWER_EDITION_BODY_INVALID" } }, requestId)
    }
    const parsed = parseBody(body)
    if (!parsed.success) {
      return response(400, { error: { code: "REVIEWER_EDITION_BODY_INVALID" } }, requestId)
    }
    try {
      const outcome = await submitReviewerEditionDecision(req.payload, {
        editionId,
        expectedRevision: parsed.data.expectedRevision,
        idempotencyKey,
        requestId,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
        target,
        user: req.user,
      })
      return response(200, outcome.response, requestId)
    } catch (error) {
      return errorResponseOf(error, requestId)
    }
  },
  method: "post",
  path:
    target === "approved"
      ? "/workspaces/reviewer/editions/:id/approve"
      : "/workspaces/reviewer/editions/:id/request-changes",
})

/** Reviewer-only synchronous decision: review → approved. */
export const reviewerApproveEditionEndpoint = reviewerEndpoint(
  "approved",
  approveBodySchema.safeParse,
)

/** Reviewer-only synchronous decision: review → draft with an audit reason. */
export const reviewerRequestChangesEditionEndpoint = reviewerEndpoint(
  "draft",
  requestChangesBodySchema.safeParse,
)

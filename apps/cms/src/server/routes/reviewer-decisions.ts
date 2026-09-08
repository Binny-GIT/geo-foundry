/*
 * 审核决策两端点的 Drizzle 路由：approve / request-changes。
 * reviewer/super-admin 专属，带 x-request-id 与 idempotency-key；
 * 幂等重放返回存储的原始响应。
 */

import { randomUUID } from "node:crypto"

import { z } from "zod"

import { IDEMPOTENCY_KEY_PATTERN, REQUEST_ID_PATTERN } from "../../endpoints/internal/contracts"
import { authenticateRequest } from "../auth/session"
import { WorkflowRepositoryError } from "../repositories/edition-workflow"
import { entityScopeOf } from "../repositories/entities"
import {
  ReviewerDecisionRepositoryError,
  ReviewerDecisionsRepository,
} from "../repositories/reviewer-decisions"
import { serverRuntime } from "../runtime"

const expectedRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const reasonSchema = z.string().trim().min(1).max(500)

const approveSchema = z.object({ expectedRevision: expectedRevisionSchema }).strict()
const requestChangesSchema = z
  .object({ expectedRevision: expectedRevisionSchema, reason: reasonSchema })
  .strict()

const json = (status: number, body: unknown, requestId: string): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
    status,
  })

const requestIdOf = (request: Request): string | null => {
  const value = request.headers.get("x-request-id")
  if (value === null) return randomUUID()
  return REQUEST_ID_PATTERN.test(value) ? value : null
}

const editionIdOf = (slug: readonly string[]): number | null => {
  const id = slug[3]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

export type ReviewerDecisionRoute = "approve" | "request-changes"

export const reviewerDecisionRouteOf = (
  slug: readonly string[] | undefined,
): ReviewerDecisionRoute | null => {
  if (
    slug?.length !== 5 ||
    slug[0] !== "workspaces" ||
    slug[1] !== "reviewer" ||
    slug[2] !== "editions"
  ) {
    return null
  }
  if (slug[4] === "approve") return "approve"
  if (slug[4] === "request-changes") return "request-changes"
  return null
}

const MASKED_NOT_FOUND = {
  error: { code: "REVIEWER_EDITION_NOT_FOUND", message: "edition not found" },
}
const CONFLICT_CODES = new Set([
  "EDITION_WORKFLOW_REVISION_CONFLICT",
  "EDITION_WORKFLOW_SOURCE_REQUIRED",
  "EDITION_WORKFLOW_ASSESSMENT_REQUIRED",
  "EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED",
  "EDITION_WORKFLOW_STALE_ASSESSMENT",
  "CONTENT_EDITION_TRANSITION_NOT_ALLOWED",
])

const errorResponseOf = (error: unknown, requestId: string): Response => {
  if (error instanceof ReviewerDecisionRepositoryError) {
    if (error.code === "IDEMPOTENCY_KEY_REUSED")
      return json(409, { error: { code: error.code } }, requestId)
    if (error.code === "REVIEWER_EDITION_REVIEWER_REQUIRED")
      return json(403, { error: { code: error.code } }, requestId)
    return json(400, { error: { code: error.code } }, requestId)
  }
  if (error instanceof WorkflowRepositoryError) {
    if (
      error.code === "EDITION_WORKFLOW_NOT_FOUND" ||
      error.code === "EDITION_WORKFLOW_TENANT_MISMATCH"
    ) {
      return json(404, MASKED_NOT_FOUND, requestId)
    }
    if (CONFLICT_CODES.has(error.code)) return json(409, { error: { code: error.code } }, requestId)
    return json(400, { error: { code: error.code } }, requestId)
  }
  return json(500, { error: { code: "REVIEWER_EDITION_INTERNAL_ERROR" } }, requestId)
}

export const handleReviewerDecisionPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const route = reviewerDecisionRouteOf(slug)
  if (route === null) return null
  const requestId = requestIdOf(request)
  if (requestId === null) {
    return json(400, { error: { code: "REVIEWER_EDITION_REQUEST_ID_INVALID" } }, randomUUID())
  }
  const editionId = editionIdOf(slug ?? [])
  if (editionId === null) {
    return json(400, { error: { code: "REVIEWER_EDITION_ID_INVALID" } }, requestId)
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) {
    return json(401, { error: { code: "REVIEWER_EDITION_UNAUTHENTICATED" } }, requestId)
  }
  if (
    auth.claims.kind !== "user" ||
    (auth.claims.role !== "reviewer" && auth.claims.role !== "super-admin")
  ) {
    return json(403, { error: { code: "REVIEWER_EDITION_REVIEWER_REQUIRED" } }, requestId)
  }
  const tenantId = auth.claims.tenantId === null ? null : Number(auth.claims.tenantId)
  if (
    auth.claims.role === "reviewer" &&
    (tenantId === null || !Number.isInteger(tenantId) || tenantId <= 0)
  ) {
    return json(403, { error: { code: "REVIEWER_EDITION_ACTOR_INVALID" } }, requestId)
  }
  const scope = entityScopeOf(auth)
  if (scope === null) {
    return json(403, { error: { code: "REVIEWER_EDITION_ACTOR_INVALID" } }, requestId)
  }
  const idempotencyKey = request.headers.get("idempotency-key")
  if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return json(400, { error: { code: "REVIEWER_EDITION_IDEMPOTENCY_KEY_INVALID" } }, requestId)
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "REVIEWER_EDITION_BODY_INVALID" } }, requestId)
  }
  let expectedRevision: number
  let reason: string | undefined
  if (route === "approve") {
    const parsed = approveSchema.safeParse(raw)
    if (!parsed.success) {
      return json(400, { error: { code: "REVIEWER_EDITION_BODY_INVALID" } }, requestId)
    }
    expectedRevision = parsed.data.expectedRevision
  } else {
    const parsed = requestChangesSchema.safeParse(raw)
    if (!parsed.success) {
      return json(400, { error: { code: "REVIEWER_EDITION_BODY_INVALID" } }, requestId)
    }
    expectedRevision = parsed.data.expectedRevision
    reason = parsed.data.reason
  }
  try {
    const outcome = await new ReviewerDecisionsRepository(serverRuntime().db).submit({
      claims: {
        kind: "user",
        role: auth.claims.role,
        tenantId,
        userId: auth.claims.userId,
      },
      editionId,
      expectedRevision,
      idempotencyKey,
      ...(reason === undefined ? {} : { reason }),
      requestId,
      scope,
      target: route === "approve" ? "approved" : "draft",
    })
    return json(200, outcome.response, requestId)
  } catch (error) {
    return errorResponseOf(error, requestId)
  }
}

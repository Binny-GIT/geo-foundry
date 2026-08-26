import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { EditionWorkflowError } from "../services/edition-workflow"
import {
  editionVersionHistory,
  EditionVersionHistoryError,
  restoreEditionDraft,
} from "../services/edition-version-history"
import { IDEMPOTENCY_KEY_PATTERN, REQUEST_ID_PATTERN } from "./internal/contracts"

const restoreBodySchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500),
    versionId: z.string().uuid(),
  })
  .strict()

const editionIdOf = (req: PayloadRequest): number | null => {
  const id = Number(req.routeParams?.["id"])
  return Number.isInteger(id) && id > 0 ? id : null
}

const requestIdOf = (req: PayloadRequest): string | null => {
  const value = req.headers?.get("x-request-id") ?? null
  return value === null ? crypto.randomUUID() : REQUEST_ID_PATTERN.test(value) ? value : null
}

const idempotencyKeyOf = (req: PayloadRequest): string | null => {
  const value = req.headers?.get("idempotency-key") ?? null
  return value !== null && IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null
}

const response = (status: number, body: unknown, requestId?: string): Response => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" })
  if (requestId !== undefined) headers.set("x-request-id", requestId)
  return new Response(JSON.stringify(body), { headers, status })
}

const notFound = (requestId: string): Response =>
  response(404, { error: { code: "EDITION_VERSION_NOT_FOUND", message: "edition not found" } }, requestId)

const errorResponseOf = (error: unknown, requestId: string): Response => {
  if (error instanceof EditionWorkflowError) {
    if (error.code === "EDITION_WORKFLOW_NOT_FOUND" || error.code === "EDITION_WORKFLOW_TENANT_MISMATCH") {
      return notFound(requestId)
    }
    if (error.code === "EDITION_WORKFLOW_REVISION_CONFLICT") {
      return response(409, { error: { code: error.code } }, requestId)
    }
  }
  if (error instanceof EditionVersionHistoryError) {
    if (error.code === "EDITION_VERSION_NOT_FOUND" || error.code === "EDITION_DRAFT_RESTORE_VERSION_NOT_FOUND") {
      return notFound(requestId)
    }
    if (error.code === "EDITION_VERSION_UNAUTHENTICATED" || error.code === "EDITION_DRAFT_RESTORE_UNAUTHENTICATED") {
      return response(401, { error: { code: error.code } }, requestId)
    }
    if (error.code === "EDITION_DRAFT_RESTORE_EDITOR_REQUIRED") {
      return response(403, { error: { code: error.code } }, requestId)
    }
    if (
      error.code === "IDEMPOTENCY_KEY_REUSED" ||
      error.code === "EDITION_DRAFT_RESTORE_DRAFT_REQUIRED" ||
      error.code === "EDITION_DRAFT_RESTORE_STALE" ||
      error.code === "EDITION_DRAFT_RESTORE_REASON_REQUIRED"
    ) {
      return response(409, { error: { code: error.code } }, requestId)
    }
    return response(400, { error: { code: error.code } }, requestId)
  }
  throw error
}

export const editionVersionHistoryEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    const requestId = requestIdOf(req)
    if (editionId === null) return response(400, { error: { code: "EDITION_VERSION_ID_INVALID" } })
    if (requestId === null) return response(400, { error: { code: "EDITION_VERSION_REQUEST_ID_INVALID" } })
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "EDITION_VERSION_UNAUTHENTICATED" } }, requestId)
    }
    try {
      const versions = await editionVersionHistory(req.payload, { editionId, user: req.user })
      return response(200, { editionId, versions }, requestId)
    } catch (error) {
      return errorResponseOf(error, requestId)
    }
  },
  method: "get",
  path: "/workspaces/editions/:id/version-history",
}

export const restoreEditionDraftEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    const requestId = requestIdOf(req)
    if (editionId === null) return response(400, { error: { code: "EDITION_DRAFT_RESTORE_ID_INVALID" } })
    if (requestId === null) return response(400, { error: { code: "EDITION_DRAFT_RESTORE_REQUEST_ID_INVALID" } })
    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return response(401, { error: { code: "EDITION_DRAFT_RESTORE_UNAUTHENTICATED" } }, requestId)
    }
    if (claims.kind !== "user" || claims.role !== "editor") {
      return response(403, { error: { code: "EDITION_DRAFT_RESTORE_EDITOR_REQUIRED" } }, requestId)
    }
    const idempotencyKey = idempotencyKeyOf(req)
    if (idempotencyKey === null) {
      return response(400, { error: { code: "EDITION_DRAFT_RESTORE_IDEMPOTENCY_KEY_INVALID" } }, requestId)
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "EDITION_DRAFT_RESTORE_BODY_INVALID" } }, requestId)
    }
    const parsed = restoreBodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "EDITION_DRAFT_RESTORE_BODY_INVALID" } }, requestId)
    }
    try {
      const outcome = await restoreEditionDraft(req.payload, {
        editionId,
        expectedRevision: parsed.data.expectedRevision,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        idempotencyKey,
        reason: parsed.data.reason,
        requestId,
        user: req.user,
        versionId: parsed.data.versionId,
      })
      return response(200, outcome.response, requestId)
    } catch (error) {
      return errorResponseOf(error, requestId)
    }
  },
  method: "post",
  path: "/workspaces/editions/:id/restore-draft",
}

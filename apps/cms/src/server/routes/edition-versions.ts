/* 文章版本历史与恢复的 Drizzle 路由；完全绕过 Payload versions API。 */

import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { canonicalize } from "../../services/edition-input-hash"
import { IDEMPOTENCY_KEY_PATTERN, REQUEST_ID_PATTERN } from "../../endpoints/internal/contracts"
import { authenticateRequest } from "../auth/session"
import { EditionsRepository } from "../repositories/editions"
import {
  EditionVersionRepositoryError,
  EditionVersionsRepository,
} from "../repositories/edition-versions"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const restoreSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500),
    versionId: z.number().int().positive(),
  })
  .strict()

const json = (status: number, body: unknown, requestId: string): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
    },
    status,
  })

const requestIdOf = (request: Request): string | null => {
  const value = request.headers.get("x-request-id")
  if (value === null) return randomUUID()
  return REQUEST_ID_PATTERN.test(value) ? value : null
}

const editionIdOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[2]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

const requestHashOf = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")

const uniqueKeyOf = (tenantId: number, endpoint: string, key: string): string =>
  createHash("sha256").update(`${tenantId}\n${endpoint}\n${key}`).digest("hex")

const errorResponse = (error: unknown, requestId: string): Response => {
  if (error instanceof EditionVersionRepositoryError) {
    return json(error.status, { error: { code: error.code } }, requestId)
  }
  return json(500, { error: { code: "EDITION_VERSION_INTERNAL_ERROR" } }, requestId)
}

const contextOf = async (
  request: Request,
  action: "history" | "restore",
  requestId: string,
) => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null) {
    return {
      response: json(
        401,
        {
          error: {
            code:
              action === "restore"
                ? "EDITION_DRAFT_RESTORE_UNAUTHENTICATED"
                : "EDITION_VERSION_UNAUTHENTICATED",
          },
        },
        requestId,
      ),
    }
  }
  if (!decideAccess(auth.claims, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) {
    return { response: json(403, { error: { code: "EDITION_VERSION_FORBIDDEN" } }, requestId) }
  }
  if (action === "restore" && (auth.claims.kind !== "user" || auth.claims.role !== "editor")) {
    return { response: json(403, { error: { code: "EDITION_DRAFT_RESTORE_EDITOR_REQUIRED" } }, requestId) }
  }
  const scope = entityScopeOf(auth)
  if (scope === null) {
    return { response: json(403, { error: { code: "TENANT_SCOPE_DENIED" } }, requestId) }
  }
  return { auth, scope }
}

export type EditionVersionRoute = "history" | "restore"

export const editionVersionRouteOf = (
  method: "GET" | "POST",
  slug: readonly string[] | undefined,
): EditionVersionRoute | null => {
  if (slug?.length !== 4 || slug[0] !== "workspaces" || slug[1] !== "editions") return null
  if (method === "GET" && slug[3] === "version-history") return "history"
  if (method === "POST" && slug[3] === "restore-draft") return "restore"
  return null
}

export const handleEditionVersionGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (editionVersionRouteOf("GET", slug) !== "history") return null
  const requestId = requestIdOf(request)
  if (requestId === null) {
    return json(400, { error: { code: "EDITION_VERSION_REQUEST_ID_INVALID" } }, randomUUID())
  }
  const editionId = editionIdOf(slug)
  if (editionId === null) return json(400, { error: { code: "EDITION_VERSION_ID_INVALID" } }, requestId)
  const context = await contextOf(request, "history", requestId)
  if ("response" in context) return context.response

  const runtime = serverRuntime()
  const document = await new EditionsRepository(runtime.db).findDraft(context.scope, editionId)
  if (document === null) {
    return json(404, { error: { code: "EDITION_VERSION_NOT_FOUND", message: "edition not found" } }, requestId)
  }
  try {
    const versions = await new EditionVersionsRepository(runtime.db).list(context.scope, editionId)
    return json(200, { editionId, versions }, requestId)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}

export const handleEditionVersionPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (editionVersionRouteOf("POST", slug) !== "restore") return null
  const requestId = requestIdOf(request)
  if (requestId === null) {
    return json(400, { error: { code: "EDITION_DRAFT_RESTORE_REQUEST_ID_INVALID" } }, randomUUID())
  }
  const editionId = editionIdOf(slug)
  if (editionId === null) {
    return json(400, { error: { code: "EDITION_DRAFT_RESTORE_ID_INVALID" } }, requestId)
  }
  const idempotencyKey = request.headers.get("idempotency-key")
  if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return json(400, { error: { code: "EDITION_DRAFT_RESTORE_IDEMPOTENCY_KEY_INVALID" } }, requestId)
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "EDITION_DRAFT_RESTORE_BODY_INVALID" } }, requestId)
  }
  const parsed = restoreSchema.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: { code: "EDITION_DRAFT_RESTORE_BODY_INVALID" } }, requestId)
  }
  const context = await contextOf(request, "restore", requestId)
  if ("response" in context) return context.response
  const tenantId = Number(context.auth.claims.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return json(401, { error: { code: "EDITION_DRAFT_RESTORE_UNAUTHENTICATED" } }, requestId)
  }
  const endpoint = `/workspaces/editions/${editionId}/restore-draft`
  const requestHash = requestHashOf({
    expectedRevision: parsed.data.expectedRevision,
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    reason: parsed.data.reason,
    versionId: parsed.data.versionId,
  })
  try {
    const outcome = await new EditionVersionsRepository(serverRuntime().db).restore(context.scope, {
      actor: {
        kind: "user",
        role: context.auth.claims.role,
        tenantId,
        userId: context.auth.claims.userId,
      },
      editionId,
      expectedRevision: parsed.data.expectedRevision,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      idempotencyKey,
      reason: parsed.data.reason,
      requestHash,
      requestId,
      uniqueKey: uniqueKeyOf(tenantId, endpoint, idempotencyKey),
      versionId: parsed.data.versionId,
    })
    return json(200, outcome.response, requestId)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}

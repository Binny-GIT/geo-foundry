/*
 * 评审评论端点的 Drizzle 路由：POST /api/editions/:id/review-comments。
 * 作者与租户由会话派生；kind 由服务端控制（comment）。
 */

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { authenticateRequest } from "../auth/session"
import type { ServerDb } from "../db/client"
import { editionVersions } from "../db/edition-schema"
import { reviewComments } from "../db/workflow-schema"
import { entityScopeOf, type EntityScope } from "../repositories/entities"
import { serverRuntime } from "../runtime"

export class CommentCreateError extends Error {
  override readonly name = "CommentCreateError"
  constructor(readonly code: string) {
    super(code)
  }
}

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(2_000),
    workflowRevision: z.number().int().min(0).optional(),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const editionIdOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[1]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

export const createReviewCommentWithDb = async (
  db: ServerDb,
  scope: EntityScope,
  input: Readonly<{
    authorId: number
    body: string
    editionId: number
    kind: "comment" | "request-changes"
    tenantBound: boolean
    workflowRevision?: number
  }>,
): Promise<number> => {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ tenantId: editionVersions.tenantId })
      .from(editionVersions)
      .where(and(eq(editionVersions.parentId, input.editionId), eq(editionVersions.latest, true)))
      .limit(1)
    const tenantId = rows[0]?.tenantId
    if (tenantId === null || tenantId === undefined) {
      throw new CommentCreateError("REVIEW_COMMENT_TENANT_MISMATCH")
    }
    if (input.tenantBound) {
      const scoped = scope.kind === "global" ? null : scope.tenantId
      if (scoped !== null && scoped !== tenantId) {
        throw new CommentCreateError("REVIEW_COMMENT_TENANT_MISMATCH")
      }
    }
    const inserted = await tx
      .insert(reviewComments)
      .values({
        authorId: input.authorId,
        body: input.body,
        editionId: input.editionId,
        kind: input.kind,
        tenantId,
        ...(input.workflowRevision === undefined
          ? {}
          : { workflowRevision: String(input.workflowRevision) }),
      })
      .returning({ id: reviewComments.id })
    const id = inserted[0]?.id
    if (id === undefined) throw new CommentCreateError("REVIEW_COMMENT_CREATE_FAILED")
    return id
  })
}

export const reviewCommentRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 3 && slug[0] === "editions" && slug[2] === "review-comments"

export const handleReviewCommentPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!reviewCommentRouteOf(slug)) return null
  const editionId = editionIdOf(slug)
  if (editionId === null) {
    return json(400, { error: { code: "REVIEW_COMMENT_EDITION_ID_INVALID" } })
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) {
    return json(401, { error: { code: "REVIEW_COMMENT_UNAUTHENTICATED" } })
  }
  if (auth.claims.kind !== "user") {
    return json(401, { error: { code: "REVIEW_COMMENT_ACTOR_INVALID" } })
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "REVIEW_COMMENT_BODY_INVALID" } })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: { code: "REVIEW_COMMENT_BODY_INVALID" } })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) {
    return json(403, { error: { code: "REVIEW_COMMENT_ACTOR_INVALID" } })
  }
  const authorId = Number(auth.claims.userId)
  if (!Number.isInteger(authorId) || authorId <= 0) {
    return json(401, { error: { code: "REVIEW_COMMENT_ACTOR_INVALID" } })
  }
  try {
    const commentId = await createReviewCommentWithDb(serverRuntime().db, scope, {
      authorId,
      body: parsed.data.body,
      editionId,
      kind: "comment",
      tenantBound: auth.claims.role !== "super-admin",
      ...(parsed.data.workflowRevision === undefined
        ? {}
        : { workflowRevision: parsed.data.workflowRevision }),
    })
    return json(201, { commentId, editionId })
  } catch (error) {
    const code = error instanceof CommentCreateError ? error.code : "REVIEW_COMMENT_CREATE_FAILED"
    if (code === "REVIEW_COMMENT_TENANT_MISMATCH") return json(404, { error: { code } })
    return json(400, { error: { code } })
  }
}

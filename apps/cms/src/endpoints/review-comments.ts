import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { createReviewComment, ReviewCommentsError } from "../services/review-comments"

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(2_000),
    workflowRevision: z.number().int().min(0).optional(),
  })
  .strict()

const editionIdOf = (req: PayloadRequest): number | null => {
  const id = Number(req.routeParams?.["id"])
  return Number.isInteger(id) && id > 0 ? id : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const createReviewCommentEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null)
      return response(400, { error: { code: "REVIEW_COMMENT_EDITION_ID_INVALID" } })
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "REVIEW_COMMENT_UNAUTHENTICATED" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "REVIEW_COMMENT_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return response(400, { error: { code: "REVIEW_COMMENT_BODY_INVALID" } })
    try {
      const commentId = await createReviewComment(req.payload, {
        body: parsed.data.body,
        editionId,
        user: req.user,
        ...(parsed.data.workflowRevision === undefined
          ? {}
          : { workflowRevision: parsed.data.workflowRevision }),
      })
      return response(201, { commentId, editionId })
    } catch (error) {
      if (!(error instanceof ReviewCommentsError)) throw error
      const status =
        error.code === "REVIEW_COMMENT_ACTOR_INVALID"
          ? 401
          : error.code === "REVIEW_COMMENT_TENANT_MISMATCH"
            ? 404
            : 400
      return response(status, { error: { code: error.code } })
    }
  },
  method: "post",
  path: "/editions/:id/review-comments",
}

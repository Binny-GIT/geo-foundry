import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import {
  addArticleSource,
  ArticleSourcesError,
  removeArticleSource,
} from "../services/article-sources"

const sourceBodySchema = z
  .object({
    intakeItemId: z.number().int().positive(),
    note: z.string().trim().max(2_000).optional(),
    role: z.enum(["primary", "supporting"]).default("supporting"),
  })
  .strict()

const positiveId = (value: unknown): number | null => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorResponse = (error: unknown): Response => {
  if (!(error instanceof ArticleSourcesError)) throw error
  const status =
    error.code === "ARTICLE_SOURCE_ACTOR_INVALID"
      ? 401
      : error.code === "ARTICLE_SOURCE_EDITOR_REQUIRED"
        ? 403
        : error.code === "ARTICLE_SOURCE_TENANT_MISMATCH"
          ? 404
          : error.code === "ARTICLE_SOURCE_DUPLICATE"
            ? 409
            : 400
  return response(status, { error: { code: error.code } })
}

export const addArticleSourceEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = positiveId(req.routeParams?.["id"])
    if (editionId === null) return response(400, { error: { code: "ARTICLE_SOURCE_EDITION_ID_INVALID" } })
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "ARTICLE_SOURCE_UNAUTHENTICATED" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "ARTICLE_SOURCE_BODY_INVALID" } })
    }
    const parsed = sourceBodySchema.safeParse(body)
    if (!parsed.success) return response(400, { error: { code: "ARTICLE_SOURCE_BODY_INVALID" } })
    try {
      const sourceId = await addArticleSource(req.payload, {
        editionId,
        intakeItemId: parsed.data.intakeItemId,
        role: parsed.data.role,
        user: req.user,
        ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
      })
      return response(201, { editionId, sourceId })
    } catch (error) {
      return errorResponse(error)
    }
  },
  method: "post",
  path: "/editions/:id/article-sources",
}

export const removeArticleSourceEndpoint: Endpoint = {
  handler: async (req) => {
    const sourceId = positiveId(req.routeParams?.["id"])
    if (sourceId === null) return response(400, { error: { code: "ARTICLE_SOURCE_ID_INVALID" } })
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "ARTICLE_SOURCE_UNAUTHENTICATED" } })
    }
    try {
      await removeArticleSource(req.payload, sourceId, req.user)
      return new Response(null, { status: 204 })
    } catch (error) {
      return errorResponse(error)
    }
  },
  method: "delete",
  path: "/article-sources/:id",
}

/*
 * 文章参考来源路由：POST /api/editions/:id/article-sources。
 * 作者/租户门禁、重复 409、跨租户 intake 拒绝与旧服务一致。
 */

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { authenticateRequest } from "../auth/session"
import { editionVersions } from "../db/edition-schema"
import { articleSources, intakeItems } from "../db/session-schema"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

export class ArticleSourceError extends Error {
  override readonly name = "ArticleSourceError"
  constructor(readonly code: string) {
    super(code)
  }
}

const bodySchema = z
  .object({
    intakeItemId: z.number().int().positive(),
    note: z.string().trim().max(2_000).optional(),
    role: z.enum(["primary", "supporting"]).default("supporting"),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const statusOf = (code: string): number =>
  code === "ARTICLE_SOURCE_ACTOR_INVALID"
    ? 401
    : code === "ARTICLE_SOURCE_EDITOR_REQUIRED"
      ? 403
      : code === "ARTICLE_SOURCE_TENANT_MISMATCH"
        ? 404
        : code === "ARTICLE_SOURCE_DUPLICATE"
          ? 409
          : 400

export const articleSourceRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 3 && slug[0] === "editions" && slug[2] === "article-sources"

export const handleArticleSourcePost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!articleSourceRouteOf(slug)) return null
  const editionId = slug?.[1] !== undefined && /^\d+$/.test(slug[1]) ? Number(slug[1]) : null
  if (editionId === null || editionId <= 0) {
    return json(400, { error: { code: "ARTICLE_SOURCE_EDITION_ID_INVALID" } })
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "ARTICLE_SOURCE_UNAUTHENTICATED" } })
  const role = auth.claims.role
  const scope = entityScopeOf(auth)
  if (scope === null) return json(401, { error: { code: "ARTICLE_SOURCE_ACTOR_INVALID" } })
  if (role !== "editor" && role !== "tenant-admin" && role !== "super-admin") {
    return json(403, { error: { code: "ARTICLE_SOURCE_EDITOR_REQUIRED" } })
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "ARTICLE_SOURCE_BODY_INVALID" } })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return json(400, { error: { code: "ARTICLE_SOURCE_BODY_INVALID" } })
  try {
    const sourceId = await serverRuntime().db.transaction(async (tx) => {
      const editionRows = await tx
        .select({ tenantId: editionVersions.tenantId })
        .from(editionVersions)
        .where(and(eq(editionVersions.parentId, editionId), eq(editionVersions.latest, true)))
        .limit(1)
      const tenantId = editionRows[0]?.tenantId
      if (tenantId === null || tenantId === undefined) {
        throw new ArticleSourceError("ARTICLE_SOURCE_TENANT_MISMATCH")
      }
      if (scope.kind !== "global" && scope.tenantId !== tenantId) {
        throw new ArticleSourceError("ARTICLE_SOURCE_TENANT_MISMATCH")
      }
      const intakeRows = await tx
        .select({ tenantId: intakeItems.tenantId })
        .from(intakeItems)
        .where(eq(intakeItems.id, parsed.data.intakeItemId))
        .limit(1)
      if (intakeRows[0]?.tenantId !== tenantId) {
        throw new ArticleSourceError("ARTICLE_SOURCE_TENANT_MISMATCH")
      }
      const duplicate = await tx
        .select({ id: articleSources.id })
        .from(articleSources)
        .where(
          and(
            eq(articleSources.editionId, editionId),
            eq(articleSources.intakeItemId, parsed.data.intakeItemId),
          ),
        )
        .limit(1)
      if (duplicate.length > 0) throw new ArticleSourceError("ARTICLE_SOURCE_DUPLICATE")
      const inserted = await tx
        .insert(articleSources)
        .values({
          editionId,
          intakeItemId: parsed.data.intakeItemId,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
          role: parsed.data.role,
          tenantId,
        })
        .returning({ id: articleSources.id })
      const id = inserted[0]?.id
      if (id === undefined) throw new ArticleSourceError("ARTICLE_SOURCE_CREATE_FAILED")
      return id
    })
    return json(201, { editionId, sourceId })
  } catch (error) {
    const code = error instanceof ArticleSourceError ? error.code : "ARTICLE_SOURCE_CREATE_FAILED"
    return json(statusOf(code), { error: { code } })
  }
}

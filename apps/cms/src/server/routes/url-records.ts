/*
 * URL 记录路由：rename（active→redirected 301 + 新 active，领域 registry 校验，
 * 单事务）。
 */

import { randomUUID } from "node:crypto"

import { parseContentId, parseSiteId, parseTenantId, parseUrlId, renameUrl } from "@geo/domain"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { buildSiteRegistry, toUrlRecordRow } from "../../services/url-registry-snapshot"
import { authenticateRequest } from "../auth/session"
import { urlRecords } from "../db/workflow-schema"
import { serverRuntime } from "../runtime"

export class UrlOpsError extends Error {
  override readonly name = "UrlOpsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const renameSchema = z
  .object({
    locale: z.string().min(2).max(64),
    pathname: z.string().min(1).max(2_000).startsWith("/"),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const urlRenameRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 3 && slug[0] === "url-record-operations" && slug[2] === "rename"

export const handleUrlRecordsPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug === undefined) return null
  if (urlRenameRouteOf(slug)) return handleRename(request, slug)
  return null
}

const handleRename = async (request: Request, slug: readonly string[]): Promise<Response> => {
  const idPart = slug[1] ?? ""
  const recordId = /^\d+$/.test(idPart) ? Number(idPart) : null
  if (recordId === null || recordId <= 0) {
    return json(400, { error: { code: "URL_RECORD_ID_INVALID" } })
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "URL_RECORD_UNAUTHENTICATED" } })
  const role = auth.claims.role
  if (auth.claims.kind !== "user" || (role !== "editor" && role !== "publisher")) {
    return json(403, { error: { code: "URL_RECORD_RENAME_FORBIDDEN" } })
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "URL_RECORD_RENAME_BODY_INVALID" } })
  }
  const parsed = renameSchema.safeParse(raw)
  if (!parsed.success) return json(400, { error: { code: "URL_RECORD_RENAME_BODY_INVALID" } })
  const tenantId = auth.claims.tenantId === null ? null : Number(auth.claims.tenantId)
  try {
    const receipt = await serverRuntime().db.transaction(async (tx) => {
      const rows = await tx.select().from(urlRecords).where(eq(urlRecords.id, recordId)).limit(1)
      const row = rows[0]
      if (row === undefined) throw new UrlOpsError("URL_RECORD_NOT_FOUND")
      if (tenantId === null || row.tenantId !== tenantId) {
        throw new UrlOpsError("URL_RECORD_TENANT_MISMATCH")
      }
      const hostnameOfRow = (() => {
        if (row.canonicalUrl === null || !URL.canParse(row.canonicalUrl)) return null
        return new URL(row.canonicalUrl).hostname
      })()
      if (hostnameOfRow === null) throw new UrlOpsError("URL_RECORD_ROW_INVALID")
      const siteRows = await tx.select().from(urlRecords).where(eq(urlRecords.siteId, row.siteId))
      const registry = buildSiteRegistry(
        siteRows.map((candidate) =>
          toUrlRecordRow({
            canonicalUrl: candidate.canonicalUrl,
            content: candidate.contentId,
            id: candidate.id,
            locale: candidate.locale,
            pathname: candidate.pathname,
            revision: Number(candidate.revision ?? 0),
            site: candidate.siteId,
            state: candidate.state,
            statusCode: candidate.statusCode === null ? null : Number(candidate.statusCode),
            targetUrl: candidate.targetUrlId,
            tenant: candidate.tenantId,
          }),
        ),
      )
      const sourceUrlId = parseUrlId(String(recordId))
      const targetUrlId = parseUrlId(randomUUID())
      const siteId = parseSiteId(String(row.siteId))
      const rowTenantId = parseTenantId(String(row.tenantId))
      const contentId = parseContentId(String(row.contentId))
      if (!sourceUrlId.ok || !targetUrlId.ok || !siteId.ok || !rowTenantId.ok || !contentId.ok) {
        throw new UrlOpsError("URL_REGISTRY_INPUT_INVALID")
      }
      const result = renameUrl(registry, {
        expectedRevision: registry.revision,
        hostname: hostnameOfRow,
        locale: parsed.data.locale,
        pathname: parsed.data.pathname,
        sourceUrlId: sourceUrlId.value,
        targetOwnership: {
          scope: "site",
          siteId: siteId.value,
          tenantId: rowTenantId.value,
        },
        targetUrlId: targetUrlId.value,
      })
      if (!result.ok) throw new UrlOpsError(result.error.code)
      const active = await tx
        .insert(urlRecords)
        .values({
          canonicalUrl: result.value.active.canonicalUrl.value,
          contentId: row.contentId,
          locale: result.value.active.locale.value,
          pathname: result.value.active.pathname.value,
          revision: "0",
          siteId: row.siteId,
          state: "active",
          tenantId: row.tenantId,
          uniqueKey: result.value.active.key.value,
        })
        .returning({ id: urlRecords.id })
      const activeId = active[0]?.id
      if (activeId === undefined) throw new UrlOpsError("URL_RECORD_CREATE_FAILED")
      await tx
        .update(urlRecords)
        .set({
          revision: String(Number(row.revision ?? 0) + 1),
          state: "redirected",
          statusCode: "301",
          targetUrlId: activeId,
          updatedAt: new Date(),
        })
        .where(eq(urlRecords.id, recordId))
      return { activeId, redirectId: recordId }
    })
    return json(200, receipt)
  } catch (error) {
    const code = error instanceof UrlOpsError ? error.code : "URL_RENAME_FAILED"
    const status =
      code === "URL_RECORD_TENANT_MISMATCH"
        ? 403
        : code === "URL_RECORD_NOT_FOUND"
          ? 404
          : code === "URL_RECORD_ID_INVALID" || code === "URL_RECORD_RENAME_BODY_INVALID"
            ? 400
            : 409
    return json(status, { error: { code } })
  }
}

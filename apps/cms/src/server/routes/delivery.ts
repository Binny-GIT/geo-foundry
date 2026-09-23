/*
 * 公开 delivery API 的 Drizzle 路由：列表 + 单篇。
 * 只暴露已发布 + 激活站点内容；字段白名单；每 IP 限流；用量聚合
 * 异步落库且绝不阻断交付（单篇接口补上真实租户，修复旧 tenantId=0 缺陷）。
 */

import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import type { ServerDb } from "../db/client"
import { contentEditions, editionSites } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { apiUsageDailies, domains } from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import { loggerOf } from "../observability/logger"
import { serverRuntime } from "../runtime"

const log = loggerOf({ component: "delivery" })

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
let rateLimitMax = RATE_LIMIT_MAX

export const configureDeliveryRateLimitForTests = (limit = RATE_LIMIT_MAX): void => {
  rateBuckets.clear()
  rateLimitMax = limit
}

const rateLimited = (key: string): boolean => {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (bucket === undefined || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > rateLimitMax
}

const json = (status: number, body: unknown, cacheSeconds?: number): Response => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" })
  if (cacheSeconds !== undefined) headers.set("cache-control", `public, max-age=${cacheSeconds}`)
  return new Response(JSON.stringify(body), { headers, status })
}

const clientKeyOf = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"

const recordUsage = (
  db: ServerDb,
  route: "article" | "articles",
  siteId: number,
  tenantId: number,
): void => {
  const date = new Date().toISOString().slice(0, 10)
  void (async () => {
    try {
      await db
        .insert(apiUsageDailies)
        .values({ count: 1, date, route, siteId, tenantId })
        .onConflictDoUpdate({
          set: { count: sql`${apiUsageDailies.count} + 1`, updatedAt: new Date() },
          target: [
            apiUsageDailies.tenantId,
            apiUsageDailies.date,
            apiUsageDailies.route,
            apiUsageDailies.siteId,
          ],
        })
    } catch (error) {
      log.warn({ err: error, route, siteId }, "usage aggregation failed")
    }
  })()
}

type SiteRow = { siteId: number; tenantId: number | null }

const activeCanonicalSite = async (db: ServerDb, domain: string): Promise<SiteRow | null> => {
  const normalized = domain.toLowerCase().trim()
  if (normalized.length === 0 || !/^[a-z0-9.-]+$/.test(normalized)) return null
  const rows = await db
    .select({ siteId: domains.siteId })
    .from(domains)
    .where(
      and(
        eq(domains.hostname, normalized),
        eq(domains.role, "canonical"),
        eq(domains.status, "active"),
      ),
    )
    .limit(1)
  const siteId = rows[0]?.siteId
  if (siteId === undefined) return null
  const siteRows = await db
    .select({ status: sites.status, tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  const site = siteRows[0]
  if (site === undefined || site.status !== "active") return null
  return { siteId, tenantId: site.tenantId ?? null }
}

const activePathnameByEdition = async (
  db: ServerDb,
  siteId: number,
): Promise<Map<number, string>> => {
  const map = new Map<number, string>()
  const records = await db
    .select({ editionId: urlRecords.editionId, pathname: urlRecords.pathname })
    .from(urlRecords)
    .where(and(eq(urlRecords.siteId, siteId), eq(urlRecords.state, "active")))
    .limit(500)
  for (const record of records) {
    if (record.pathname.length > 0 && !map.has(record.editionId)) {
      map.set(record.editionId, record.pathname)
    }
  }
  return map
}

const publicEdition = (
  row: typeof contentEditions.$inferSelect,
  pathname: string | undefined,
): Record<string, unknown> => ({
  id: row.id,
  publishedAt: row.createdAt.toISOString(),
  summary: row.summary ?? "",
  title: row.title ?? "",
  updatedAt: row.updatedAt.toISOString(),
  ...(pathname === undefined ? {} : { pathname, url: pathname }),
})

export const deliveryRouteOf = (
  slug: readonly string[] | undefined,
): "articles" | "article" | null => {
  if (slug?.[0] !== "delivery") return null
  if (slug.length === 4 && slug[1] === "sites" && slug[3] === "articles") return "articles"
  if (slug.length === 3 && slug[1] === "articles") return "article"
  return null
}

export const handleDeliveryGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const route = deliveryRouteOf(slug)
  if (route === null) return null
  if (rateLimited(clientKeyOf(request))) {
    return json(429, { error: { code: "DELIVERY_RATE_LIMITED" } })
  }
  const db = serverRuntime().db

  if (route === "articles") {
    const site = await activeCanonicalSite(db, slug?.[2] ?? "")
    if (site === null) return json(404, { error: { code: "DELIVERY_SITE_NOT_FOUND" } }, 60)
    const url = new URL(request.url)
    const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1)
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10)
    const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100)

    // A2 多站：成员与"已发布"判定读 edition_sites.publish_state
    // （该行存在且 published 才算发到该站），不再看文章 site_id/sites 数组。
    const where = and(
      eq(contentEditions.workflowStatus, "published"),
      sql`EXISTS (
        SELECT 1 FROM ${editionSites}
        WHERE ${editionSites.editionId} = ${contentEditions.id}
          AND ${editionSites.siteId} = ${site.siteId}
          AND ${editionSites.publishState} = 'published'
      )`,
      ...(q.length === 0 ? [] : [ilike(contentEditions.title, `%${q}%`)]),
    )
    const [rows, totals, pathnames] = await Promise.all([
      db
        .select()
        .from(contentEditions)
        .where(where)
        .orderBy(desc(contentEditions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(contentEditions).where(where),
      activePathnameByEdition(db, site.siteId),
    ])
    if (site.tenantId !== null) recordUsage(db, "articles", site.siteId, site.tenantId)
    const totalDocs = totals[0]?.value ?? 0
    return json(
      200,
      {
        docs: rows.map((row) => publicEdition(row, pathnames.get(row.id))),
        page,
        totalDocs,
        totalPages: Math.max(Math.ceil(totalDocs / limit), 1),
      },
      60,
    )
  }

  const id = Number(slug?.[2])
  if (!Number.isSafeInteger(id) || id <= 0) {
    return json(400, { error: { code: "DELIVERY_ARTICLE_ID_INVALID" } })
  }
  const rows = await db.select().from(contentEditions).where(eq(contentEditions.id, id)).limit(1)
  const edition = rows[0]
  if (edition === undefined || edition.workflowStatus !== "published") {
    return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
  }
  // A2 多站：已发布站点 = edition_sites 中 publish_state='published' 的行
  // （不再"取第一个活跃站点"）。主站确定性选择：文章主站已发布则用主站，
  // 否则最小已发布站点 ID；响应额外带 sites 数组（各站 pathname/locale）。
  const publishedRows = await db
    .select({ siteId: editionSites.siteId })
    .from(editionSites)
    .where(and(eq(editionSites.editionId, id), eq(editionSites.publishState, "published")))
  const publishedSiteIds = [...new Set(publishedRows.map((row) => row.siteId))].sort(
    (left, right) => left - right,
  )
  const activeRows =
    publishedSiteIds.length === 0
      ? []
      : await db
          .select({ id: sites.id, locale: sites.locale, tenantId: sites.tenantId })
          .from(sites)
          .where(and(eq(sites.status, "active"), inArray(sites.id, publishedSiteIds)))
  const activeById = new Map(activeRows.map((row) => [row.id, row]))
  const usableSiteIds = publishedSiteIds.filter((siteId) => activeById.has(siteId))
  const firstUsableSiteId = usableSiteIds[0]
  if (firstUsableSiteId === undefined) {
    return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
  }
  const primarySiteId =
    edition.siteId !== null && usableSiteIds.includes(edition.siteId)
      ? edition.siteId
      : firstUsableSiteId
  const urlRows = await db
    .select({ pathname: urlRecords.pathname, siteId: urlRecords.siteId })
    .from(urlRecords)
    .where(
      and(
        eq(urlRecords.editionId, id),
        eq(urlRecords.state, "active"),
        inArray(urlRecords.siteId, usableSiteIds),
      ),
    )
  const pathnameBySite = new Map<number, string>()
  for (const row of urlRows) {
    if (row.pathname.length > 0 && !pathnameBySite.has(row.siteId)) {
      pathnameBySite.set(row.siteId, row.pathname)
    }
  }
  const primarySite = activeById.get(primarySiteId)
  if (primarySite === undefined) {
    return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
  }
  if (primarySite.tenantId !== null) {
    recordUsage(db, "article", primarySite.id, primarySite.tenantId)
  }
  const markdown = edition.bodyMarkdown ?? ""
  return json(
    200,
    {
      ...publicEdition(edition, pathnameBySite.get(primarySiteId)),
      body: markdown.length > 0 ? markdownToBlocks(markdown) : [],
      locale: primarySite.locale ?? "en-US",
      sites: usableSiteIds.map((siteId) => {
        const site = activeById.get(siteId)
        const pathname = pathnameBySite.get(siteId)
        return {
          locale: site?.locale ?? "en-US",
          ...(pathname === undefined ? {} : { pathname, url: pathname }),
          siteId,
        }
      }),
    },
    60,
  )
}

/*
 * 编译快照的 Drizzle 实现：站点 + canonical 域名 + 可编译文章（当前草稿版本
 * 行，等价 Payload draft:true）+ 最近评估 + URL 注册表派生路由。
 * 输出形状与 services/compile-snapshot.ts 一致，mapper 复用。
 */

import type { CompileRequest, CompileSiteSnapshot } from "@geo/compiler"
import { and, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { markdownToBlocks } from "../../editor/block-markdown"
import {
  deriveListings,
  deriveRoutes,
  mapEdition,
  textOf,
} from "../../services/compile-snapshot-mappers"
import { EditionWorkflowError } from "../../services/edition-workflow"
import type { ServerDb } from "../db/client"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { domains, qualityAssessments } from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import { serviceScopeOf } from "./edition-integration"

const fail = (code: string, detail: string): EditionWorkflowError =>
  new EditionWorkflowError(code, detail)

const COMPILABLE_STATUSES = ["approved", "compiled", "published"] as const

const isoOf = (value: Date | null | undefined): string | undefined =>
  value === null || value === undefined ? undefined : value.toISOString()

export const buildCompileSnapshot = async (
  db: ServerDb,
  options: { readonly siteId: number; readonly user: unknown },
): Promise<Omit<CompileRequest, "clock" | "compilerVersion">> => {
  const siteRows = await db.select().from(sites).where(eq(sites.id, options.siteId)).limit(1)
  const site = siteRows[0]
  if (site === undefined) throw fail("COMPILE_SNAPSHOT_SITE_MISSING", `site ${options.siteId}`)
  const scope = serviceScopeOf(options.user)
  if (scope.kind !== "tenant" || scope.tenantId !== site.tenantId) {
    throw fail("COMPILE_SNAPSHOT_TENANT_MISMATCH", `site ${options.siteId}`)
  }

  const domainRows = await db
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(
      and(
        eq(domains.siteId, options.siteId),
        eq(domains.role, "canonical"),
        eq(domains.status, "active"),
      ),
    )
    .limit(1)
  const canonicalDomain = textOf(domainRows[0]?.hostname)
  if (canonicalDomain.length === 0) {
    throw fail("COMPILE_SNAPSHOT_CANONICAL_DOMAIN_MISSING", `site ${options.siteId}`)
  }

  const siteName = textOf(site.name)
  const siteKey = `site-${options.siteId}`
  const compileSite: CompileSiteSnapshot = {
    canonicalDomain,
    locale: textOf(site.locale) || "en-US",
    name: siteName,
    organization: { name: siteName },
    seoDefaults: {
      description: textOf(site.seoDefaultsDefaultDescription) || `${siteName} content`,
      title: textOf(site.seoDefaultsTitleSuffix) || siteName,
    },
    siteId: siteKey,
    timezone: textOf(site.timezone) || "UTC",
  }

  const versionRows = await db
    .select({ editionId: contentEditions.id, version: editionVersions })
    .from(contentEditions)
    .innerJoin(
      editionVersions,
      and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
    )
    .where(
      and(
        eq(editionVersions.siteId, options.siteId),
        inArray(editionVersions.workflowStatus, [...COMPILABLE_STATUSES]),
      ),
    )
    .limit(500)

  const editionIds = versionRows.map((row) => row.editionId)
  const latestAssessment = new Map<number, { state: string; inputHash: string }>()
  if (editionIds.length > 0) {
    const assessments = await db
      .select({
        editionId: qualityAssessments.editionId,
        inputHash: qualityAssessments.inputHash,
        state: qualityAssessments.state,
      })
      .from(qualityAssessments)
      .where(inArray(qualityAssessments.editionId, editionIds))
      .orderBy(desc(qualityAssessments.createdAt))
      .limit(editionIds.length * 4)
    for (const row of assessments) {
      if (!latestAssessment.has(row.editionId)) {
        latestAssessment.set(row.editionId, { inputHash: row.inputHash, state: row.state })
      }
    }
  }

  const target = alias(urlRecords, "target")
  const urlRows = await db
    .select({
      editionId: urlRecords.editionId,
      pathname: urlRecords.pathname,
      state: urlRecords.state,
      targetPathname: target.pathname,
    })
    .from(urlRecords)
    .leftJoin(target, eq(target.id, urlRecords.targetUrlId))
    .where(eq(urlRecords.siteId, options.siteId))
    .limit(1000)
  const { activeUrlByContent, redirects } = deriveRoutes(
    urlRows.map((row) => ({
      content: row.editionId,
      pathname: row.pathname,
      state: row.state,
      targetUrl: row.targetPathname === null ? null : { pathname: row.targetPathname },
    })),
  )

  const topics: { categories: string[]; tags: string[] }[] = []
  const compileEditions = []
  for (const { editionId, version } of versionRows) {
    const urlPathname = activeUrlByContent.get(editionId)
    if (urlPathname === undefined) continue
    const mapped = mapEdition({
      assessment: latestAssessment.get(editionId),
      authorId: `author-site-${options.siteId}`,
      authorName: `${siteName} Editorial Team`,
      canonicalDomain,
      edition: {
        body: markdownToBlocks(version.bodyMarkdown ?? ""),
        citations: version.citations,
        content: editionId,
        contentModifiedAt: isoOf(version.contentModifiedAt),
        createdAt: isoOf(version.versionCreatedAt ?? version.createdAt),
        entities: version.entities,
        id: editionId,
        primaryTopic: version.primaryTopic,
        secondaryTopics: version.secondaryTopics,
        summary: version.summary,
        title: version.title,
        updatedAt: isoOf(version.versionUpdatedAt ?? version.updatedAt),
      },
      siteKey,
      urlPathname,
    })
    if (mapped === null) continue
    compileEditions.push(mapped)
    topics.push({ categories: [...mapped.categories], tags: [...mapped.tags] })
  }

  return {
    editions: compileEditions,
    listings: {
      articles: { pathname: "/articles", pageSize: 20 },
      ...deriveListings(topics),
    },
    notFound: { pathname: "/not-found" },
    redirects: [...redirects].sort((left, right) =>
      left.fromPathname.localeCompare(right.fromPathname),
    ),
    site: compileSite,
  }
}

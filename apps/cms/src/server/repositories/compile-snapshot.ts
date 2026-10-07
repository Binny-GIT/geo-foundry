/*
 * 编译快照的 Drizzle 实现：站点 + canonical 域名 + 可编译文章（编辑中的
 * 已发布文章使用本站历史发布修订）+ 对应评估 + URL 注册表派生路由。
 * 输出形状与 services/compile-snapshot.ts 一致，mapper 复用。
 */

import {
  type CompileRequest,
  type CompileSiteSnapshot,
  GEO_MEDIA_PATH_PREFIX,
  geoMediaSrcOf,
} from "@geo/compiler"
import { and, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { markdownToBlocks } from "../../editor/block-markdown"
import {
  deriveListings,
  deriveRoutes,
  type MediaRowInput,
  mapEdition,
  mediaEntriesOf,
  textOf,
} from "../../services/compile-snapshot-mappers"
import { EditionWorkflowError } from "../../services/edition-workflow"
import type { ServerDb } from "../db/client"
import { media, sites } from "../db/entity-schema"
import { domains, qualityAssessments } from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import {
  publishedAssessmentQuery,
  readSnapshotVersions,
  snapshotContentHash,
} from "./compile-snapshot-selection"
import { serviceScopeOf } from "./edition-integration"
import { passedSiteAddAssessmentId } from "./site-evaluation"

const fail = (code: string, detail: string): EditionWorkflowError =>
  new EditionWorkflowError(code, detail)

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

  const versionRows = await readSnapshotVersions(db, options.siteId)

  const editionIds = versionRows.filter((row) => !row.fallback).map((row) => row.editionId)
  const latestAssessment = new Map<number, { state: string; inputHash: string }>()
  if (editionIds.length > 0) {
    // A3 质量检查按站：门禁按 (文章 × 本站) 取最新结论——本站没有评估行的
    // 文章（新加的站点）视为未通过，必须重新评估；不再共享其他站的结论。
    const assessments = await db
      .select({
        editionId: qualityAssessments.editionId,
        inputHash: qualityAssessments.inputHash,
        state: qualityAssessments.state,
      })
      .from(qualityAssessments)
      .where(
        and(
          inArray(qualityAssessments.editionId, editionIds),
          eq(qualityAssessments.siteId, options.siteId),
        ),
      )
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
  const { activeUrlByContent, gonePathnames, redirects } = deriveRoutes(
    urlRows.map((row) => ({
      content: row.editionId,
      pathname: row.pathname,
      state: row.state,
      targetUrl: row.targetPathname === null ? null : { pathname: row.targetPathname },
    })),
  )
  const publishedUrlByEdition = new Map(
    urlRows.filter((row) => row.state === "active").map((row) => [row.editionId, row.pathname]),
  )

  // 带图文章编译：先解析所有正文图片，批量查 media 表（文件名全局唯一），
  // 再按篇生成快照媒体条目；查不到的引用由编译器报 MEDIA_MISSING。
  const blocksByEdition = new Map<number, ReturnType<typeof markdownToBlocks>>()
  const referencedFilenames = new Set<string>()
  for (const { editionId, version } of versionRows) {
    const blocks = markdownToBlocks(version.bodyMarkdown ?? "")
    blocksByEdition.set(editionId, blocks)
    for (const block of blocks) {
      if (block["blockType"] !== "image") continue
      const path = geoMediaSrcOf(block["src"])
      if (path !== null) referencedFilenames.add(path.slice(GEO_MEDIA_PATH_PREFIX.length))
    }
  }
  const mediaByFilename = new Map<string, MediaRowInput>()
  if (referencedFilenames.size > 0) {
    const mediaRows = await db
      .select()
      .from(media)
      .where(inArray(media.filename, [...referencedFilenames]))
      .limit(referencedFilenames.size)
    for (const row of mediaRows) {
      if (row.filename !== null) {
        mediaByFilename.set(row.filename, {
          alt: row.alt,
          id: row.id,
          ...(row.mimeType === null ? {} : { mimeType: row.mimeType }),
          tenantId: row.tenantId,
        })
      }
    }
  }

  const topics: { categories: string[]; tags: string[] }[] = []
  const compileEditions = []
  for (const { editionId, version, fallback } of versionRows) {
    const urlPathname = (fallback ? publishedUrlByEdition : activeUrlByContent).get(editionId)
    if (urlPathname === undefined) continue
    let eligibleAssessment: { readonly inputHash: string; readonly state: string } | undefined
    if (fallback) {
      // 编辑期只沿用本站同内容 hash 的评估；新草稿/新增站点操作的评估不能
      // 代替线上旧内容的证据。缺失或失败仍交由编译器拒绝，不跳过质量门禁。
      eligibleAssessment = (
        await publishedAssessmentQuery(db, {
          editionId,
          inputHash: snapshotContentHash(version),
          siteId: options.siteId,
        })
      )[0]
    } else {
      const addEvaluation = await passedSiteAddAssessmentId(db, editionId, options.siteId)
      const linkedAssessment =
        addEvaluation.assessmentId === null
          ? undefined
          : (
              await db
                .select({
                  inputHash: qualityAssessments.inputHash,
                  state: qualityAssessments.state,
                })
                .from(qualityAssessments)
                .where(eq(qualityAssessments.id, addEvaluation.assessmentId))
                .limit(1)
            )[0]
      eligibleAssessment = addEvaluation.addOperationExists
        ? linkedAssessment
        : latestAssessment.get(editionId)
    }
    const blocks = blocksByEdition.get(editionId) ?? []
    const mapped = mapEdition({
      assessment: eligibleAssessment,
      canonicalDomain,
      edition: {
        body: blocks,
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
      media: mediaEntriesOf(blocks, mediaByFilename),
      siteKey,
      urlPathname,
    })
    if (mapped === null) continue
    compileEditions.push(mapped)
    topics.push({ categories: [...mapped.categories], tags: [...mapped.tags] })
  }

  return {
    editions: compileEditions,
    gonePathnames: [...gonePathnames].sort(),
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

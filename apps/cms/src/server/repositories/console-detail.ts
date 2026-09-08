/*
 * 文章详情页 / 站点详情页的聚合读取。文章取当前草稿版本（Payload draft:true
 * 语义），关系字段解析为对象；操作人邮箱映射跨租户按 id 解析（与旧实现的
 * overrideAccess:true 等价，只暴露邮箱）。
 */

import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import type { ServerDb } from "../db/client"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { operations } from "../db/ledger-schema"
import { tenants, users } from "../db/schema"
import { domains, releases } from "../db/session-schema"
import { reviewComments, urlRecords } from "../db/workflow-schema"
import { findSite, operationDoc } from "./console-collections"
import type { EntityScope } from "./entities"

type Row = Record<string, unknown>

const tenantPredicate = (scope: EntityScope, column: Parameters<typeof eq>[0]) =>
  scope.kind === "global" ? [] : [eq(column, scope.tenantId)]

export type ArticleDetailData = Readonly<{
  actorEmailById: ReadonlyMap<number, string>
  comments: readonly Row[]
  edition: Row
  hostname: string | null
  pathname: string | null
  siteOptions: readonly Readonly<{ id: number; label: string }>[]
  userOptions: readonly Readonly<{ id: number; label: string }>[]
}>

export const loadArticleDetail = async (
  db: ServerDb,
  scope: EntityScope,
  editionId: number,
  include: Readonly<{ assignmentOptions: boolean }>,
): Promise<ArticleDetailData | null> => {
  const rows = await db
    .select({
      editionId: contentEditions.id,
      siteName: sites.name,
      siteTimezone: sites.timezone,
      tenantName: tenants.name,
      version: editionVersions,
    })
    .from(contentEditions)
    .innerJoin(
      editionVersions,
      and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
    )
    .leftJoin(sites, eq(sites.id, editionVersions.siteId))
    .leftJoin(tenants, eq(tenants.id, editionVersions.tenantId))
    .where(
      and(eq(contentEditions.id, editionId), ...tenantPredicate(scope, editionVersions.tenantId)),
    )
    .limit(1)
  const row = rows[0]
  if (row === undefined) return null
  const { version } = row
  const assignedSites = version.sites
  const editionTenantId = version.tenantId
  const [urlRow, domainRow, comments, userOptions, siteOptions] = await Promise.all([
    db
      .select({ pathname: urlRecords.pathname })
      .from(urlRecords)
      .where(and(eq(urlRecords.editionId, editionId), eq(urlRecords.state, "active")))
      .limit(1),
    version.siteId === null
      ? []
      : db
          .select({ hostname: domains.hostname })
          .from(domains)
          .where(
            and(
              eq(domains.siteId, version.siteId),
              eq(domains.role, "canonical"),
              eq(domains.status, "active"),
            ),
          )
          .limit(1),
    db
      .select()
      .from(reviewComments)
      .where(
        and(
          eq(reviewComments.editionId, editionId),
          ...tenantPredicate(scope, reviewComments.tenantId),
        ),
      )
      .orderBy(desc(reviewComments.createdAt))
      .limit(50),
    include.assignmentOptions && editionTenantId !== null
      ? db
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, editionTenantId), ne(users.role, "content-service")))
          .orderBy(asc(users.email))
          .limit(100)
      : [],
    editionTenantId !== null
      ? db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(eq(sites.tenantId, editionTenantId))
          .orderBy(asc(sites.name))
          .limit(100)
      : [],
  ])
  const audit = Array.isArray(version.auditLog) ? version.auditLog : []
  const actorIds = [
    ...new Set([
      ...audit.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return []
        const actor = (entry as Row)["actor"]
        if (typeof actor !== "object" || actor === null) return []
        const actorRow = actor as Row
        if (actorRow["kind"] !== "user") return []
        const id = Number(actorRow["userId"])
        return Number.isInteger(id) && id > 0 ? [id] : []
      }),
      ...comments.map((comment) => comment.authorId),
    ]),
  ]
  const actorRows =
    actorIds.length === 0
      ? []
      : await db
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(inArray(users.id, actorIds))
  const markdown = version.bodyMarkdown ?? ""
  return {
    actorEmailById: new Map(actorRows.map((user) => [user.id, user.email] as const)),
    comments: comments.map((comment) => ({
      author: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      id: comment.id,
      kind: comment.kind,
      workflowRevision: comment.workflowRevision === null ? null : Number(comment.workflowRevision),
    })),
    edition: {
      auditLog: audit,
      body: markdownToBlocks(markdown),
      bodyMarkdown: markdown,
      creationOrigin: version.creationOrigin ?? "human",
      id: row.editionId,
      owner: version.ownerId,
      site:
        version.siteId === null
          ? null
          : { id: version.siteId, name: row.siteName, timezone: row.siteTimezone },
      sites: assignedSites,
      summary: version.summary ?? "",
      tenant: version.tenantId === null ? null : { id: version.tenantId, name: row.tenantName },
      title: version.title ?? "",
      updatedAt: (version.versionUpdatedAt ?? version.updatedAt).toISOString(),
      workflowRevision: Number(version.workflowRevision ?? 0),
      workflowStatus: version.workflowStatus ?? "draft",
    },
    hostname: domainRow[0]?.hostname ?? null,
    pathname: urlRow[0]?.pathname ?? null,
    siteOptions: siteOptions.map((site) => ({
      id: site.id,
      label: site.name.length > 0 ? site.name : `站点 #${site.id}`,
    })),
    userOptions: userOptions.map((user) => ({
      id: user.id,
      label: user.email.length > 0 ? user.email : `用户 #${user.id}`,
    })),
  }
}

export type SiteDetailData = Readonly<{
  canonicalHostname: string | null
  domains: readonly Row[] | null
  operations: readonly Row[] | null
  recentEditions: readonly Row[] | null
  releases: readonly Row[] | null
  site: Row
  statusCounts: ReadonlyMap<string, number> | null
}>

export const loadSiteDetail = async (
  db: ServerDb,
  scope: EntityScope,
  siteId: number,
  include: Readonly<{
    domains: boolean
    editions: boolean
    operations: boolean
    releases: boolean
  }>,
): Promise<SiteDetailData | null> => {
  const site = await findSite(db, scope, siteId)
  if (site === null) return null
  const latestJoin = and(
    eq(editionVersions.parentId, contentEditions.id),
    eq(editionVersions.latest, true),
  )
  const [statusRows, domainRows, canonicalRows, editionRows, releaseRows, operationRows] =
    await Promise.all([
      include.editions
        ? db
            .select({ status: editionVersions.workflowStatus, value: count() })
            .from(contentEditions)
            .innerJoin(editionVersions, latestJoin)
            .where(
              and(
                eq(editionVersions.siteId, siteId),
                ...tenantPredicate(scope, editionVersions.tenantId),
              ),
            )
            .groupBy(editionVersions.workflowStatus)
        : null,
      include.domains
        ? db
            .select()
            .from(domains)
            .where(eq(domains.siteId, siteId))
            .orderBy(asc(domains.hostname))
            .limit(50)
        : null,
      include.domains
        ? db
            .select({ hostname: domains.hostname })
            .from(domains)
            .where(
              and(
                eq(domains.siteId, siteId),
                eq(domains.role, "canonical"),
                eq(domains.status, "active"),
              ),
            )
            .limit(1)
        : [],
      include.editions
        ? db
            .select({ editionId: contentEditions.id, version: editionVersions })
            .from(contentEditions)
            .innerJoin(editionVersions, latestJoin)
            .where(
              and(
                eq(editionVersions.siteId, siteId),
                ...tenantPredicate(scope, editionVersions.tenantId),
              ),
            )
            .orderBy(desc(editionVersions.versionUpdatedAt))
            .limit(10)
        : null,
      include.releases
        ? db
            .select()
            .from(releases)
            .where(and(eq(releases.siteId, siteId), ...tenantPredicate(scope, releases.tenantId)))
            .orderBy(desc(releases.createdAt))
            .limit(20)
        : null,
      include.operations
        ? db
            .select()
            .from(operations)
            .where(
              and(eq(operations.siteId, siteId), ...tenantPredicate(scope, operations.tenantId)),
            )
            .orderBy(desc(operations.updatedAt))
            .limit(10)
        : null,
    ])
  return {
    canonicalHostname: canonicalRows[0]?.hostname ?? null,
    domains:
      domainRows === null
        ? null
        : domainRows.map((domain) => ({
            hostname: domain.hostname,
            id: domain.id,
            role: domain.role,
            status: domain.status,
          })),
    operations: operationRows === null ? null : operationRows.map(operationDoc),
    recentEditions:
      editionRows === null
        ? null
        : editionRows.map((row) => ({
            id: row.editionId,
            title: row.version.title ?? "",
            updatedAt: (row.version.versionUpdatedAt ?? row.version.updatedAt).toISOString(),
            workflowStatus: row.version.workflowStatus ?? "draft",
          })),
    releases:
      releaseRows === null
        ? null
        : releaseRows.map((release) => ({
            createdAt: release.createdAt.toISOString(),
            id: release.id,
            manifestSha256: release.manifestSha256,
            releaseId: release.releaseId,
            state: release.state,
          })),
    site,
    statusCounts:
      statusRows === null
        ? null
        : new Map(statusRows.map((row) => [row.status ?? "draft", Number(row.value)] as const)),
  }
}

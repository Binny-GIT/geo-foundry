/*
 * Console 页面级只读查询（控制台首页 / 接口统计 / 稿源收件箱 / 工作台看板 /
 * 发布排期）。范围规则与 Payload readScope 一致：global 不加租户谓词，
 * tenant 范围强制 tenant_id 过滤；站点收窄（siteIds）只是 UI 层显示范围。
 * 文章状态一律取当前草稿版本（latest），与看板口径一致。
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, type SQL, sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { operations } from "../db/ledger-schema"
import { tenants, users } from "../db/schema"
import { apiUsageDailies, intakeItems, publicationPlans, releases } from "../db/session-schema"
import type { EntityScope } from "./entities"

type Row = Record<string, unknown>

const tenantOf = (scope: EntityScope): number | null =>
  scope.kind === "global" ? null : scope.tenantId

const scoped = (scope: EntityScope, column: Parameters<typeof eq>[0]): SQL[] => {
  const tenantId = tenantOf(scope)
  return tenantId === null ? [] : [eq(column, tenantId)]
}

const latestVersionJoin = and(
  eq(editionVersions.parentId, contentEditions.id),
  eq(editionVersions.latest, true),
)

const matchesAnySite = (siteIds: readonly number[]): SQL =>
  siteIds.length === 0
    ? sql`false`
    : (or(
        inArray(editionVersions.siteId, [...siteIds]),
        sql`${editionVersions.sites} && ARRAY[${sql.join(
          siteIds.map((siteId) => sql`${siteId}`),
          sql`, `,
        )}]::integer[]`,
      ) ?? sql`false`)

export type NamedOption = Readonly<{ id: number; name: string }>

export const listSiteOptions = async (
  db: ServerDb,
  scope: EntityScope,
  limit = 100,
): Promise<readonly NamedOption[]> => {
  const rows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(...scoped(scope, sites.tenantId)))
    .orderBy(asc(sites.name))
    .limit(limit)
  return rows.filter((row) => row.name.length > 0)
}

export const listTenantOptions = async (
  db: ServerDb,
  scope: EntityScope,
): Promise<readonly NamedOption[]> => {
  const rows = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(scope.kind === "global" ? undefined : eq(tenants.id, scope.tenantId))
    .orderBy(asc(tenants.name))
    .limit(100)
  return rows
}

export const listOwnerOptions = async (
  db: ServerDb,
  scope: EntityScope,
): Promise<readonly Readonly<{ email: string; id: number }>[]> =>
  db
    .select({ email: users.email, id: users.id })
    .from(users)
    .where(and(...scoped(scope, users.tenantId)))
    .orderBy(asc(users.email))
    .limit(100)

export const failedOperationsCount = async (db: ServerDb, scope: EntityScope): Promise<number> => {
  const rows = await db
    .select({ value: count() })
    .from(operations)
    .where(and(eq(operations.state, "failed"), ...scoped(scope, operations.tenantId)))
  return Number(rows[0]?.value ?? 0)
}

/* ---------- 控制台首页 ---------- */

export type DashboardStats = Readonly<{
  editionCountsByStatus: ReadonlyMap<string, number>
  editionCountsBySite: readonly Readonly<{ label: string; value: number }>[]
  intakeDays: readonly string[]
  releaseDays: readonly string[]
}>

export const dashboardStats = async (
  db: ServerDb,
  scope: EntityScope,
  input: Readonly<{
    cutoff: Date
    includeEditions: boolean
    includeIntake: boolean
    includeReleases: boolean
    includeSites: boolean
  }>,
): Promise<DashboardStats> => {
  const [statusRows, intakeRows, releaseRows, siteRows] = await Promise.all([
    input.includeEditions
      ? db
          .select({ status: editionVersions.workflowStatus, value: count() })
          .from(contentEditions)
          .innerJoin(editionVersions, latestVersionJoin)
          .where(and(...scoped(scope, editionVersions.tenantId)))
          .groupBy(editionVersions.workflowStatus)
      : [],
    input.includeIntake
      ? db
          .select({ createdAt: intakeItems.createdAt })
          .from(intakeItems)
          .where(
            and(gte(intakeItems.createdAt, input.cutoff), ...scoped(scope, intakeItems.tenantId)),
          )
          .orderBy(desc(intakeItems.createdAt))
          .limit(1000)
      : [],
    input.includeReleases
      ? db
          .select({ createdAt: releases.createdAt })
          .from(releases)
          .where(and(gte(releases.createdAt, input.cutoff), ...scoped(scope, releases.tenantId)))
          .orderBy(desc(releases.createdAt))
          .limit(1000)
      : [],
    input.includeSites ? listSiteOptions(db, scope, 12) : [],
  ])
  const editionCountsBySite =
    input.includeSites && input.includeEditions && siteRows.length > 0
      ? await (async () => {
          const perSite = await db
            .select({ siteId: editionVersions.siteId, value: count() })
            .from(contentEditions)
            .innerJoin(editionVersions, latestVersionJoin)
            .where(
              and(
                inArray(
                  editionVersions.siteId,
                  siteRows.map((row) => row.id),
                ),
                ...scoped(scope, editionVersions.tenantId),
              ),
            )
            .groupBy(editionVersions.siteId)
          const bySite = new Map(perSite.map((row) => [row.siteId, Number(row.value)] as const))
          return siteRows.map((site) => ({ label: site.name, value: bySite.get(site.id) ?? 0 }))
        })()
      : []
  return {
    editionCountsBySite,
    editionCountsByStatus: new Map(
      statusRows.map((row) => [row.status ?? "draft", Number(row.value)] as const),
    ),
    intakeDays: intakeRows.map((row) => row.createdAt.toISOString()),
    releaseDays: releaseRows.map((row) => row.createdAt.toISOString()),
  }
}

/* ---------- 接口统计 ---------- */

export const apiUsageSince = async (
  db: ServerDb,
  scope: EntityScope,
  cutoffDay: string,
): Promise<readonly Readonly<{ count: number; date: string; siteId: number | null }>[]> => {
  const rows = await db
    .select({
      count: apiUsageDailies.count,
      date: apiUsageDailies.date,
      siteId: apiUsageDailies.siteId,
    })
    .from(apiUsageDailies)
    .where(and(gte(apiUsageDailies.date, cutoffDay), ...scoped(scope, apiUsageDailies.tenantId)))
    .orderBy(desc(apiUsageDailies.date))
    .limit(500)
  return rows.map((row) => ({ count: row.count ?? 0, date: row.date ?? "", siteId: row.siteId }))
}

/* ---------- 稿源收件箱 ---------- */

export const listInboxItems = async (
  db: ServerDb,
  scope: EntityScope,
  filter: Readonly<{ channel: string; status: string }>,
): Promise<readonly Row[]> => {
  type Channel = (typeof intakeItems.$inferSelect)["channel"]
  type Status = (typeof intakeItems.$inferSelect)["status"]
  const rows = await db
    .select()
    .from(intakeItems)
    .where(
      and(
        ...(filter.channel.length === 0
          ? []
          : [eq(intakeItems.channel, filter.channel as Channel)]),
        ...(filter.status.length === 0 ? [] : [eq(intakeItems.status, filter.status as Status)]),
        ...scoped(scope, intakeItems.tenantId),
      ),
    )
    .orderBy(desc(intakeItems.receivedAt))
    .limit(50)
  return rows.map((row) => ({
    adoptedEdition: row.adoptedEditionId,
    assignedTo: row.assignedToId,
    channel: row.channel,
    connector: row.connectorId,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    duplicateOf: row.duplicateOfId,
    duplicateStatus: row.duplicateStatus,
    failureCode: row.failureCode,
    failureReason: row.failureReason,
    id: row.id,
    mergedInto: row.mergedIntoId,
    normalizedUrl: row.normalizedUrl,
    receivedAt: row.receivedAt.toISOString(),
    snapshot: row.snapshotId,
    sourceUrl: row.sourceUrl,
    status: row.status,
    suggestedSite: row.suggestedSiteId,
    summary: row.summary,
    tenant: row.tenantId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/* ---------- 工作台看板 ---------- */

export type WorkBoardFilter = Readonly<{
  from: Date
  owner: readonly number[]
  q: string | null
  site: readonly number[]
  siteScope: readonly number[] | null
  toExclusive: Date
}>

export const workBoardEditions = async (
  db: ServerDb,
  scope: EntityScope,
  filter: WorkBoardFilter,
  limit: number,
): Promise<Readonly<{ docs: readonly Row[]; totalDocs: number }>> => {
  const predicates: SQL[] = [
    ...scoped(scope, editionVersions.tenantId),
    gte(editionVersions.versionUpdatedAt, filter.from),
    lt(editionVersions.versionUpdatedAt, filter.toExclusive),
  ]
  if (filter.q !== null) predicates.push(ilike(editionVersions.title, `%${filter.q}%`))
  if (filter.owner.length > 0) predicates.push(inArray(editionVersions.ownerId, [...filter.owner]))
  if (filter.siteScope !== null) {
    predicates.push(matchesAnySite(filter.siteScope))
  }
  if (filter.site.length > 0) {
    predicates.push(matchesAnySite(filter.site))
  }
  const where = and(...predicates)
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        editionId: contentEditions.id,
        ownerEmail: users.email,
        siteName: sites.name,
        siteTimezone: sites.timezone,
        version: editionVersions,
      })
      .from(contentEditions)
      .innerJoin(editionVersions, latestVersionJoin)
      .leftJoin(users, eq(users.id, editionVersions.ownerId))
      .leftJoin(sites, eq(sites.id, editionVersions.siteId))
      .where(where)
      .orderBy(desc(editionVersions.versionUpdatedAt))
      .limit(limit),
    db
      .select({ value: count() })
      .from(contentEditions)
      .innerJoin(editionVersions, latestVersionJoin)
      .where(where),
  ])
  return {
    docs: rows.map((row) => ({
      auditLog: Array.isArray(row.version.auditLog) ? row.version.auditLog : [],
      id: row.editionId,
      owner:
        row.ownerEmail === null
          ? row.version.ownerId
          : { email: row.ownerEmail, id: row.version.ownerId },
      site:
        row.siteName === null
          ? row.version.siteId
          : { id: row.version.siteId, name: row.siteName, timezone: row.siteTimezone },
      title: row.version.title ?? "",
      updatedAt: (row.version.versionUpdatedAt ?? row.version.updatedAt).toISOString(),
      workflowRevision: Number(row.version.workflowRevision ?? 0),
      workflowStatus: row.version.workflowStatus ?? "draft",
    })),
    totalDocs: Number(totalRows[0]?.value ?? 0),
  }
}

/* ---------- 发布排期 ---------- */

const planRowOf = (row: {
  editionTitle: string | null
  plan: typeof publicationPlans.$inferSelect
  siteName: string | null
}): Row => ({
  attempts: Number(row.plan.attempts ?? 0),
  claimedAt: row.plan.claimedAt?.toISOString() ?? null,
  claimedBy: row.plan.claimedBy,
  createdAt: row.plan.createdAt.toISOString(),
  edition: { id: row.plan.editionId, title: row.editionTitle ?? "" },
  id: row.plan.id,
  lastError: row.plan.lastError,
  operationId: row.plan.operationId,
  planId: row.plan.planId,
  publishedAt: row.plan.publishedAt?.toISOString() ?? null,
  releaseId: row.plan.releaseId,
  requestedBy: row.plan.requestedById,
  scheduledFor: row.plan.scheduledFor.toISOString(),
  site: { id: row.plan.siteId, name: row.siteName ?? "" },
  status: row.plan.status,
  tenant: row.plan.tenantId,
  timezone: row.plan.timezone,
  updatedAt: row.plan.updatedAt.toISOString(),
})

export const publicationPlanRows = async (
  db: ServerDb,
  scope: EntityScope,
): Promise<Readonly<{ active: readonly Row[]; terminal: readonly Row[] }>> => {
  const base = () =>
    db
      .select({
        editionTitle: editionVersions.title,
        plan: publicationPlans,
        siteName: sites.name,
      })
      .from(publicationPlans)
      .leftJoin(
        editionVersions,
        and(
          eq(editionVersions.parentId, publicationPlans.editionId),
          eq(editionVersions.latest, true),
        ),
      )
      .leftJoin(sites, eq(sites.id, publicationPlans.siteId))
  const [active, terminal] = await Promise.all([
    base()
      .where(
        and(
          inArray(publicationPlans.status, ["pending", "running"]),
          ...scoped(scope, publicationPlans.tenantId),
        ),
      )
      .orderBy(asc(publicationPlans.scheduledFor))
      .limit(100),
    base()
      .where(
        and(
          inArray(publicationPlans.status, ["succeeded", "failed", "cancelled"]),
          ...scoped(scope, publicationPlans.tenantId),
        ),
      )
      .orderBy(desc(publicationPlans.updatedAt))
      .limit(10),
  ])
  return { active: active.map(planRowOf), terminal: terminal.map(planRowOf) }
}

/** 站点 → 当前草稿版本数（工作台/站点列表共用）。 */
export const editionCountsBySite = async (
  db: ServerDb,
  scope: EntityScope,
  siteIds: readonly number[],
): Promise<ReadonlyMap<number, number>> => {
  if (siteIds.length === 0) return new Map()
  const rows = await db
    .select({ siteId: editionVersions.siteId, value: count() })
    .from(contentEditions)
    .innerJoin(editionVersions, latestVersionJoin)
    .where(
      and(
        inArray(editionVersions.siteId, [...siteIds]),
        ...scoped(scope, editionVersions.tenantId),
      ),
    )
    .groupBy(editionVersions.siteId)
  return new Map(
    rows.flatMap((row) => (row.siteId === null ? [] : [[row.siteId, Number(row.value)] as const])),
  )
}

/** 站点 → 最近一次 release 时间。 */
export const latestReleaseBySite = async (
  db: ServerDb,
  scope: EntityScope,
  siteIds: readonly number[],
): Promise<ReadonlyMap<number, string>> => {
  if (siteIds.length === 0) return new Map()
  const rows = await db
    .select({ latest: sql<Date>`max(${releases.createdAt})`, siteId: releases.siteId })
    .from(releases)
    .where(and(inArray(releases.siteId, [...siteIds]), ...scoped(scope, releases.tenantId)))
    .groupBy(releases.siteId)
  return new Map(
    rows.flatMap((row) =>
      row.latest === null ? [] : [[row.siteId, new Date(row.latest).toISOString()] as const],
    ),
  )
}

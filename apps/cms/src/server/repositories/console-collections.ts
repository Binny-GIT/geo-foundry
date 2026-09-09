/*
 * Console 通用集合视图（列表 / 详情）的 Drizzle 实现。每个 slug 一个显式
 * 查询：关系列以 {id, name|title|email|hostname|pathname} 对象返回，与
 * 页面现有的 formatValue 约定一致；租户范围强制加在各表的 tenant_id 上。
 */

import { and, count, desc, eq, ilike, inArray, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type { ConsoleResourceSlug } from "../../console/lib/resources"
import type { ServerDb } from "../db/client"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { media, sites } from "../db/entity-schema"
import { operations } from "../db/ledger-schema"
import { tenants, users } from "../db/schema"
import {
  domains,
  publicationPlans,
  qualityAssessments,
  releases,
  rollbackIntents,
} from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import { editionCountsBySite, latestReleaseBySite } from "./console-reads"
import { type EntityScope, stringList } from "./entities"

type Row = Record<string, unknown>

export type ConsolePage = Readonly<{
  docs: readonly Row[]
  page: number
  totalDocs: number
  totalPages: number
}>

export type ConsoleListInput = Readonly<{
  limit: number
  page: number
  /** users：role / tenant / q；content-editions：site / status / tenant / q。 */
  q?: string | null
  role?: string | null
  site?: number | null
  /** editor/reviewer/publisher 的站点显示收窄。 */
  siteScope?: readonly number[] | null
  status?: string | null
  tenant?: number | null
}>

const tenantOf = (scope: EntityScope): number | null =>
  scope.kind === "global" ? null : scope.tenantId

const scoped = (scope: EntityScope, column: Parameters<typeof eq>[0]): SQL[] => {
  const tenantId = tenantOf(scope)
  return tenantId === null ? [] : [eq(column, tenantId)]
}

const pageOf = (docs: readonly Row[], totalDocs: number, input: ConsoleListInput): ConsolePage => ({
  docs,
  page: input.page,
  totalDocs,
  totalPages: Math.max(1, Math.ceil(totalDocs / input.limit)),
})

const offsetOf = (input: ConsoleListInput): number => (input.page - 1) * input.limit

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null

const rel = (
  id: number | null,
  label: string | null,
  field: "name" | "title" | "email" | "hostname" | "pathname",
): unknown => (id === null ? null : label === null ? id : { id, [field]: label })

const latestJoin = and(
  eq(editionVersions.parentId, contentEditions.id),
  eq(editionVersions.latest, true),
)

/* ---------- users ---------- */

const usersBase = (db: ServerDb) =>
  db
    .select({ tenantName: tenants.name, user: users })
    .from(users)
    .leftJoin(tenants, eq(tenants.id, users.tenantId))

const userDoc = (row: { tenantName: string | null; user: typeof users.$inferSelect }): Row => ({
  createdAt: iso(row.user.createdAt),
  email: row.user.email,
  enableAPIKey: row.user.enableAPIToken ?? false,
  id: row.user.id,
  role: row.user.role,
  sites: [],
  tenant: rel(row.user.tenantId, row.tenantName, "name"),
  updatedAt: iso(row.user.updatedAt),
})

const listUsers = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  type Role = (typeof users.$inferSelect)["role"]
  const where = and(
    ...scoped(scope, users.tenantId),
    ...(input.role ? [eq(users.role, input.role as Role)] : []),
    ...(input.tenant !== null && input.tenant !== undefined
      ? [
          eq(
            users.tenantId,
            scope.kind === "global" || input.tenant === scope.tenantId ? input.tenant : -1,
          ),
        ]
      : []),
    ...(input.q ? [ilike(users.email, `%${input.q}%`)] : []),
  )
  const [rows, total] = await Promise.all([
    usersBase(db)
      .where(where)
      .orderBy(desc(users.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(users).where(where),
  ])
  return pageOf(rows.map(userDoc), Number(total[0]?.value ?? 0), input)
}

const findUser = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await usersBase(db)
    .where(and(eq(users.id, id), ...scoped(scope, users.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : userDoc(rows[0])
}

/* ---------- tenants ---------- */

const tenantDoc = (row: typeof tenants.$inferSelect): Row => ({
  createdAt: iso(row.createdAt),
  id: row.id,
  name: row.name,
  updatedAt: iso(row.updatedAt),
})

const listTenants = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = scope.kind === "global" ? undefined : eq(tenants.id, scope.tenantId)
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(tenants)
      .where(where)
      .orderBy(desc(tenants.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(tenants).where(where),
  ])
  return pageOf(rows.map(tenantDoc), Number(total[0]?.value ?? 0), input)
}

const findTenant = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  if (scope.kind !== "global" && scope.tenantId !== id) return null
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
  return rows[0] === undefined ? null : tenantDoc(rows[0])
}

/* ---------- sites ---------- */

const sitesBase = (db: ServerDb) =>
  db
    .select({ site: sites, tenantName: tenants.name })
    .from(sites)
    .leftJoin(tenants, eq(tenants.id, sites.tenantId))

export const siteDoc = (row: {
  site: typeof sites.$inferSelect
  tenantName: string | null
}): Row => ({
  contentStrategy: {
    contentAngles: stringList(row.site.contentStrategyContentAngles),
    cta: row.site.contentStrategyCta,
    expertise: stringList(row.site.contentStrategyExpertise),
    language: row.site.contentStrategyLanguage,
    positioning: row.site.contentStrategyPositioning,
    preferredTopics: stringList(row.site.contentStrategyPreferredTopics),
    prohibitedExpressions: stringList(row.site.contentStrategyProhibitedExpressions),
    prohibitedTopics: stringList(row.site.contentStrategyProhibitedTopics),
    targetAudience: stringList(row.site.contentStrategyTargetAudience),
    tone: row.site.contentStrategyTone,
  },
  createdAt: iso(row.site.createdAt),
  id: row.site.id,
  locale: row.site.locale,
  name: row.site.name,
  qualityThresholds: {
    crossDomainBlock: Number(row.site.qualityThresholdsCrossDomainBlock ?? 0.92),
    crossDomainReview: Number(row.site.qualityThresholdsCrossDomainReview ?? 0.85),
    dimensionMinimum: Number(row.site.qualityThresholdsDimensionMinimum ?? 75),
    overallMinimum: Number(row.site.qualityThresholdsOverallMinimum ?? 80),
    sameSiteTitleBlock: Number(row.site.qualityThresholdsSameSiteTitleBlock ?? 0.9),
  },
  seoDefaults: {
    defaultDescription: row.site.seoDefaultsDefaultDescription,
    titleSuffix: row.site.seoDefaultsTitleSuffix,
  },
  status: row.site.status,
  tenant: rel(row.site.tenantId, row.tenantName, "name"),
  timezone: row.site.timezone,
  updatedAt: iso(row.site.updatedAt),
})

const listSites = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(
    ...scoped(scope, sites.tenantId),
    ...(input.siteScope ? [inArray(sites.id, [...input.siteScope])] : []),
  )
  const [rows, total] = await Promise.all([
    sitesBase(db)
      .where(where)
      .orderBy(desc(sites.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(sites).where(where),
  ])
  return pageOf(rows.map(siteDoc), Number(total[0]?.value ?? 0), input)
}

export const findSite = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
): Promise<Row | null> => {
  const rows = await sitesBase(db)
    .where(and(eq(sites.id, id), ...scoped(scope, sites.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : siteDoc(rows[0])
}

/** 站点列表页附加列：文章数与最近发布时间。 */
export const siteListExtras = async (
  db: ServerDb,
  scope: EntityScope,
  siteIds: readonly number[],
  include: Readonly<{ editions: boolean; releases: boolean }>,
): Promise<
  Readonly<{
    articleCounts: ReadonlyMap<number, number>
    lastReleases: ReadonlyMap<number, string>
  }>
> => {
  const [articleCounts, lastReleases] = await Promise.all([
    include.editions ? editionCountsBySite(db, scope, siteIds) : new Map<number, number>(),
    include.releases ? latestReleaseBySite(db, scope, siteIds) : new Map<number, string>(),
  ])
  return { articleCounts, lastReleases }
}

/* ---------- domains ---------- */

const domainsBase = (db: ServerDb) =>
  db
    .select({ domain: domains, siteName: sites.name })
    .from(domains)
    .leftJoin(sites, eq(sites.id, domains.siteId))

const domainDoc = (row: { domain: typeof domains.$inferSelect; siteName: string | null }): Row => ({
  createdAt: iso(row.domain.createdAt),
  hostname: row.domain.hostname,
  id: row.domain.id,
  role: row.domain.role,
  site: rel(row.domain.siteId, row.siteName, "name"),
  status: row.domain.status,
  tenant: row.domain.tenantId,
  updatedAt: iso(row.domain.updatedAt),
})

const listDomains = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, domains.tenantId))
  const [rows, total] = await Promise.all([
    domainsBase(db)
      .where(where)
      .orderBy(desc(domains.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(domains).where(where),
  ])
  return pageOf(rows.map(domainDoc), Number(total[0]?.value ?? 0), input)
}

const findDomain = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await domainsBase(db)
    .where(and(eq(domains.id, id), ...scoped(scope, domains.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : domainDoc(rows[0])
}

/* ---------- content-editions ---------- */

const editionsBase = (db: ServerDb) =>
  db
    .select({
      editionId: contentEditions.id,
      ownerEmail: users.email,
      siteName: sites.name,
      tenantName: tenants.name,
      version: editionVersions,
    })
    .from(contentEditions)
    .innerJoin(editionVersions, latestJoin)
    .leftJoin(sites, eq(sites.id, editionVersions.siteId))
    .leftJoin(users, eq(users.id, editionVersions.ownerId))
    .leftJoin(tenants, eq(tenants.id, editionVersions.tenantId))

const editionDoc = (
  row: Awaited<ReturnType<ReturnType<typeof editionsBase>["execute"]>>[number],
): Row => ({
  createdAt: iso(row.version.versionCreatedAt ?? row.version.createdAt),
  creationOrigin: row.version.creationOrigin,
  id: row.editionId,
  owner: rel(row.version.ownerId, row.ownerEmail, "email"),
  site: rel(row.version.siteId, row.siteName, "name"),
  summary: row.version.summary ?? "",
  tenant: rel(row.version.tenantId, row.tenantName, "name"),
  title: row.version.title ?? "",
  updatedAt: iso(row.version.versionUpdatedAt ?? row.version.updatedAt),
  workflowRevision: Number(row.version.workflowRevision ?? 0),
  workflowStatus: row.version.workflowStatus ?? "draft",
})

const listEditions = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  type Status = Exclude<(typeof editionVersions.$inferSelect)["workflowStatus"], null>
  const where = and(
    ...scoped(scope, editionVersions.tenantId),
    ...(input.site ? [eq(editionVersions.siteId, input.site)] : []),
    ...(input.status ? [eq(editionVersions.workflowStatus, input.status as Status)] : []),
    ...(input.tenant !== null && input.tenant !== undefined
      ? [
          eq(
            editionVersions.tenantId,
            scope.kind === "global" || input.tenant === scope.tenantId ? input.tenant : -1,
          ),
        ]
      : []),
    ...(input.q ? [ilike(editionVersions.title, `%${input.q}%`)] : []),
    ...(input.siteScope ? [inArray(editionVersions.siteId, [...input.siteScope])] : []),
  )
  const [rows, total] = await Promise.all([
    editionsBase(db)
      .where(where)
      .orderBy(desc(editionVersions.versionUpdatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db
      .select({ value: count() })
      .from(contentEditions)
      .innerJoin(editionVersions, latestJoin)
      .where(where),
  ])
  return pageOf(rows.map(editionDoc), Number(total[0]?.value ?? 0), input)
}

/* ---------- media ---------- */

const mediaDoc = (row: typeof media.$inferSelect): Row => {
  const filename = row.filename ?? ""
  return {
    alt: row.alt,
    caption: row.caption,
    createdAt: iso(row.createdAt),
    filename: row.filename,
    filesize: row.filesize,
    id: row.id,
    mediaPath: filename.length === 0 ? null : `/media/tenants/${row.tenantId}/${filename}`,
    mimeType: row.mimeType,
    tenant: row.tenantId,
    updatedAt: iso(row.updatedAt),
    url: filename.length === 0 ? null : `/api/media/file/${filename}`,
  }
}

const listMedia = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, media.tenantId))
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(media)
      .where(where)
      .orderBy(desc(media.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(media).where(where),
  ])
  return pageOf(rows.map(mediaDoc), Number(total[0]?.value ?? 0), input)
}

const findMedia = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.id, id), ...scoped(scope, media.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : mediaDoc(rows[0])
}

/* ---------- url-records ---------- */

const targetUrl = alias(urlRecords, "target_url")

const urlBase = (db: ServerDb) =>
  db
    .select({ record: urlRecords, siteName: sites.name, targetPathname: targetUrl.pathname })
    .from(urlRecords)
    .leftJoin(sites, eq(sites.id, urlRecords.siteId))
    .leftJoin(targetUrl, eq(targetUrl.id, urlRecords.targetUrlId))

const urlDoc = (row: {
  record: typeof urlRecords.$inferSelect
  siteName: string | null
  targetPathname: string | null
}): Row => ({
  canonicalUrl: row.record.canonicalUrl,
  edition: row.record.editionId,
  createdAt: iso(row.record.createdAt),
  id: row.record.id,
  locale: row.record.locale,
  pathname: row.record.pathname,
  revision: Number(row.record.revision ?? 0),
  site: rel(row.record.siteId, row.siteName, "name"),
  state: row.record.state,
  statusCode: row.record.statusCode === null ? null : Number(row.record.statusCode),
  targetUrl: rel(row.record.targetUrlId, row.targetPathname, "pathname"),
  tenant: row.record.tenantId,
  updatedAt: iso(row.record.updatedAt),
})

const listUrlRecords = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, urlRecords.tenantId))
  const [rows, total] = await Promise.all([
    urlBase(db)
      .where(where)
      .orderBy(desc(urlRecords.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(urlRecords).where(where),
  ])
  return pageOf(rows.map(urlDoc), Number(total[0]?.value ?? 0), input)
}

const findUrlRecord = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await urlBase(db)
    .where(and(eq(urlRecords.id, id), ...scoped(scope, urlRecords.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : urlDoc(rows[0])
}

/* ---------- quality-assessments ---------- */

const assessmentsBase = (db: ServerDb) =>
  db
    .select({
      assessment: qualityAssessments,
      editionTitle: editionVersions.title,
      siteName: sites.name,
      tenantName: tenants.name,
    })
    .from(qualityAssessments)
    .leftJoin(
      editionVersions,
      and(
        eq(editionVersions.parentId, qualityAssessments.editionId),
        eq(editionVersions.latest, true),
      ),
    )
    .leftJoin(sites, eq(sites.id, qualityAssessments.siteId))
    .leftJoin(tenants, eq(tenants.id, qualityAssessments.tenantId))

const assessmentDoc = (
  row: Awaited<ReturnType<ReturnType<typeof assessmentsBase>["execute"]>>[number],
): Row => ({
  createdAt: iso(row.assessment.createdAt),
  dimensions: row.assessment.dimensions,
  edition: rel(row.assessment.editionId, row.editionTitle, "title"),
  id: row.assessment.id,
  inputHash: row.assessment.inputHash,
  issues: row.assessment.issues,
  modelId: row.assessment.modelId,
  overall: row.assessment.overall === null ? null : Number(row.assessment.overall),
  promptVersion: row.assessment.promptVersion,
  provider: row.assessment.provider,
  site: rel(row.assessment.siteId, row.siteName, "name"),
  state: row.assessment.state,
  tenant: rel(row.assessment.tenantId, row.tenantName, "name"),
  thresholdsHash: row.assessment.thresholdsHash,
  updatedAt: iso(row.assessment.updatedAt),
})

const listAssessments = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, qualityAssessments.tenantId))
  const [rows, total] = await Promise.all([
    assessmentsBase(db)
      .where(where)
      .orderBy(desc(qualityAssessments.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(qualityAssessments).where(where),
  ])
  return pageOf(rows.map(assessmentDoc), Number(total[0]?.value ?? 0), input)
}

const findAssessment = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
): Promise<Row | null> => {
  const rows = await assessmentsBase(db)
    .where(and(eq(qualityAssessments.id, id), ...scoped(scope, qualityAssessments.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : assessmentDoc(rows[0])
}

/* ---------- releases ---------- */

const releasesBase = (db: ServerDb) =>
  db
    .select({ release: releases, siteName: sites.name, tenantName: tenants.name })
    .from(releases)
    .leftJoin(sites, eq(sites.id, releases.siteId))
    .leftJoin(tenants, eq(tenants.id, releases.tenantId))

const releaseDoc = (row: {
  release: typeof releases.$inferSelect
  siteName: string | null
  tenantName: string | null
}): Row => ({
  auditLog: row.release.auditLog,
  createdAt: iso(row.release.createdAt),
  id: row.release.id,
  manifestSha256: row.release.manifestSha256,
  operationId: row.release.operationId,
  receipt: row.release.receipt,
  releaseId: row.release.releaseId,
  revision: Number(row.release.revision ?? 0),
  runtimeSiteId: row.release.runtimeSiteId,
  site: rel(row.release.siteId, row.siteName, "name"),
  state: row.release.state,
  tenant: rel(row.release.tenantId, row.tenantName, "name"),
  updatedAt: iso(row.release.updatedAt),
})

const listReleases = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, releases.tenantId))
  const [rows, total] = await Promise.all([
    releasesBase(db)
      .where(where)
      .orderBy(desc(releases.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(releases).where(where),
  ])
  return pageOf(rows.map(releaseDoc), Number(total[0]?.value ?? 0), input)
}

const findRelease = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await releasesBase(db)
    .where(and(eq(releases.id, id), ...scoped(scope, releases.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : releaseDoc(rows[0])
}

/* ---------- rollback-intents ---------- */

const intentsBase = (db: ServerDb) =>
  db
    .select({ intent: rollbackIntents, siteName: sites.name, tenantName: tenants.name })
    .from(rollbackIntents)
    .leftJoin(sites, eq(sites.id, rollbackIntents.siteId))
    .leftJoin(tenants, eq(tenants.id, rollbackIntents.tenantId))

const intentDoc = (row: {
  intent: typeof rollbackIntents.$inferSelect
  siteName: string | null
  tenantName: string | null
}): Row => ({
  approvedBy: row.intent.approvedBy,
  consumedAt: iso(row.intent.consumedAt),
  createdAt: iso(row.intent.createdAt),
  expectedCurrentManifestSha256: row.intent.expectedCurrentManifestSha256,
  expectedCurrentReleaseId: row.intent.expectedCurrentReleaseId,
  expectedManifestSha256: row.intent.expectedManifestSha256,
  fromManifestSha256: row.intent.fromManifestSha256,
  fromReleaseId: row.intent.fromReleaseId,
  id: row.intent.id,
  intentId: row.intent.intentId,
  operationId: row.intent.operationId,
  reason: row.intent.reason,
  runtimeSiteId: row.intent.runtimeSiteId,
  site: rel(row.intent.siteId, row.siteName, "name"),
  targetReleaseId: row.intent.targetReleaseId,
  tenant: rel(row.intent.tenantId, row.tenantName, "name"),
  updatedAt: iso(row.intent.updatedAt),
})

const listIntents = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, rollbackIntents.tenantId))
  const [rows, total] = await Promise.all([
    intentsBase(db)
      .where(where)
      .orderBy(desc(rollbackIntents.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(rollbackIntents).where(where),
  ])
  return pageOf(rows.map(intentDoc), Number(total[0]?.value ?? 0), input)
}

const findIntent = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await intentsBase(db)
    .where(and(eq(rollbackIntents.id, id), ...scoped(scope, rollbackIntents.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : intentDoc(rows[0])
}

/* ---------- publication-plans ---------- */

const plansBase = (db: ServerDb) =>
  db
    .select({
      editionTitle: editionVersions.title,
      plan: publicationPlans,
      siteName: sites.name,
      tenantName: tenants.name,
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
    .leftJoin(tenants, eq(tenants.id, publicationPlans.tenantId))

const planDoc = (
  row: Awaited<ReturnType<ReturnType<typeof plansBase>["execute"]>>[number],
): Row => ({
  attempts: Number(row.plan.attempts ?? 0),
  createdAt: iso(row.plan.createdAt),
  edition: rel(row.plan.editionId, row.editionTitle, "title"),
  id: row.plan.id,
  lastError: row.plan.lastError,
  operationId: row.plan.operationId,
  planId: row.plan.planId,
  publishedAt: iso(row.plan.publishedAt),
  releaseId: row.plan.releaseId,
  scheduledFor: iso(row.plan.scheduledFor),
  site: rel(row.plan.siteId, row.siteName, "name"),
  status: row.plan.status,
  tenant: rel(row.plan.tenantId, row.tenantName, "name"),
  timezone: row.plan.timezone,
  updatedAt: iso(row.plan.updatedAt),
})

const listPlans = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, publicationPlans.tenantId))
  const [rows, total] = await Promise.all([
    plansBase(db)
      .where(where)
      .orderBy(desc(publicationPlans.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(publicationPlans).where(where),
  ])
  return pageOf(rows.map(planDoc), Number(total[0]?.value ?? 0), input)
}

const findPlan = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await plansBase(db)
    .where(and(eq(publicationPlans.id, id), ...scoped(scope, publicationPlans.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : planDoc(rows[0])
}

/* ---------- operations ---------- */

export const operationDoc = (row: typeof operations.$inferSelect): Row => ({
  attempt: Number(row.attempt ?? 1),
  auditLog: row.auditLog,
  createdAt: iso(row.createdAt),
  currentStage: row.currentStage,
  endpoint: row.endpoint,
  error: row.error,
  id: row.id,
  lastStageAt: iso(row.lastStageAt),
  operationId: row.operationId,
  operationType: row.operationType,
  requestPayload: row.requestPayload,
  result: row.result,
  revision: Number(row.revision ?? 0),
  site: row.siteId,
  state: row.state,
  targetIds: row.targetIds,
  tenant: row.tenantId,
  updatedAt: iso(row.updatedAt),
})

const listOperations = async (
  db: ServerDb,
  scope: EntityScope,
  input: ConsoleListInput,
): Promise<ConsolePage> => {
  const where = and(...scoped(scope, operations.tenantId))
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(operations)
      .where(where)
      .orderBy(desc(operations.updatedAt))
      .limit(input.limit)
      .offset(offsetOf(input)),
    db.select({ value: count() }).from(operations).where(where),
  ])
  return pageOf(rows.map(operationDoc), Number(total[0]?.value ?? 0), input)
}

const findOperation = async (db: ServerDb, scope: EntityScope, id: number): Promise<Row | null> => {
  const rows = await db
    .select()
    .from(operations)
    .where(and(eq(operations.id, id), ...scoped(scope, operations.tenantId)))
    .limit(1)
  return rows[0] === undefined ? null : operationDoc(rows[0])
}

/* ---------- 分发 ---------- */

type Lister = (db: ServerDb, scope: EntityScope, input: ConsoleListInput) => Promise<ConsolePage>
type Finder = (db: ServerDb, scope: EntityScope, id: number) => Promise<Row | null>

const LISTERS: Readonly<Record<ConsoleResourceSlug, Lister>> = {
  "content-editions": listEditions,
  domains: listDomains,
  media: listMedia,
  operations: listOperations,
  "publication-plans": listPlans,
  "quality-assessments": listAssessments,
  releases: listReleases,
  "rollback-intents": listIntents,
  sites: listSites,
  tenants: listTenants,
  "url-records": listUrlRecords,
  users: listUsers,
}

const FINDERS: Readonly<Record<ConsoleResourceSlug, Finder>> = {
  "content-editions": async () => null,
  domains: findDomain,
  media: findMedia,
  operations: findOperation,
  "publication-plans": findPlan,
  "quality-assessments": findAssessment,
  releases: findRelease,
  "rollback-intents": findIntent,
  sites: findSite,
  tenants: findTenant,
  "url-records": findUrlRecord,
  users: findUser,
}

export const listConsoleCollection = (
  db: ServerDb,
  scope: EntityScope,
  slug: ConsoleResourceSlug,
  input: ConsoleListInput,
): Promise<ConsolePage> =>
  LISTERS[slug](db, scope, {
    ...input,
    limit: Math.min(Math.max(input.limit, 1), 100),
    page: Math.max(input.page, 1),
  })

export const findConsoleRecord = (
  db: ServerDb,
  scope: EntityScope,
  slug: ConsoleResourceSlug,
  id: number,
): Promise<Row | null> => FINDERS[slug](db, scope, id)

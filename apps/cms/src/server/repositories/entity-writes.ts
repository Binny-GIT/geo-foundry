/*
 * 基础实体写入（tenants / domains / sites / users）。规则来自原 Payload
 * collection hooks 与 access 函数：
 * - 租户绑定永远来自会话（super-admin 例外：域名跟随站点租户）；
 * - 角色分配走 resolveRoleAssignment（防提权）；用户租户不变量；
 * - 域名主机名规范化 + 唯一 + 与站点同租户；
 * - 站点 locale/timezone 领域校验；hasMany 文本仍写 sites_texts（清理 DDL 时转列）。
 */

import { normalizeLocale, normalizeSiteHost, validateTimezone } from "@geo/domain"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { resolveRoleAssignment } from "../../access/role-assignment"
import { CMS_ROLE, CMS_ROLES } from "../../access/roles"
import type { SessionClaims } from "../../access/session"
import { validateUserTenantInvariant } from "../../access/user-tenant-invariant"
import { hashPassword } from "../auth/password"
import type { ServerDb } from "../db/client"
import { connectors, sites } from "../db/entity-schema"
import { tenants, users } from "../db/schema"
import { domains } from "../db/session-schema"
import { findConsoleRecord } from "./console-collections"
import type { EntityScope } from "./entities"

export class EntityWriteError extends Error {
  override readonly name = "EntityWriteError"
  constructor(
    readonly code: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, status = 400, detail?: string): EntityWriteError =>
  new EntityWriteError(code, status, detail)

type Row = Record<string, unknown>
type Tx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

const sessionTenantOf = (claims: SessionClaims): number | null => {
  const tenantId = Number(claims.tenantId)
  return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null
}

const assertScope = (scope: EntityScope, rowTenantId: number | null): void => {
  if (scope.kind === "global") return
  if (rowTenantId !== scope.tenantId) throw fail("CMS_TENANT_MISMATCH", 404)
}

/* Drizzle 0.45 把 pg 错误包成 DrizzleQueryError，原始 code 在 cause 上。 */
const isUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/* ---------- connectors ---------- */

const connectorSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    pollIntervalMinutes: z.coerce.number().int().min(5).max(10_080).default(60),
    site: z.coerce.number().int().positive(),
    sourceEndpoint: z.string().trim().max(2_000).optional(),
    status: z.enum(["active", "disabled"]).default("active"),
    type: z.enum(["manual", "url", "webhook", "rss"]),
  })
  .strict()

const connectorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    pollIntervalMinutes: z.coerce.number().int().min(5).max(10_080).optional(),
    site: z.coerce.number().int().positive().optional(),
    /* 空串/null 表示清空端点（停用抓取但保留配置）。 */
    sourceEndpoint: z.string().trim().max(2_000).nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .strict()

const connectorEndpointOf = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw fail("CMS_CONNECTOR_ENDPOINT_INVALID", 400, "端点必须是 http/https URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail("CMS_CONNECTOR_ENDPOINT_INVALID", 400, "端点必须是 http/https URL")
  }
  return url.toString()
}

type ConnectorRow = typeof connectors.$inferSelect

const connectorDtoOf = (row: ConnectorRow): Row => ({
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  lastPolledAt: row.lastPolledAt === null ? null : row.lastPolledAt.toISOString(),
  name: row.name,
  pollIntervalMinutes: row.pollIntervalMinutes,
  site: row.siteId,
  sourceEndpoint: row.sourceEndpoint,
  status: row.status,
  tenant: row.tenantId,
  type: row.type,
  updatedAt: row.updatedAt.toISOString(),
})

const connectorSiteTenantOf = async (tx: Tx, siteId: number): Promise<number> => {
  const rows = await tx
    .select({ tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  const tenantId = rows[0]?.tenantId
  if (tenantId === undefined) throw fail("CMS_CONNECTOR_SITE_NOT_FOUND", 400)
  return tenantId
}

export const createConnector = async (
  db: ServerDb,
  _scope: EntityScope,
  claims: SessionClaims,
  input: unknown,
): Promise<Row> => {
  const parsed = connectorSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_CONNECTOR_INPUT_INVALID")
  /* 矩阵里只有 tenant-admin 有 connectors.create，租户必来自会话。 */
  const tenantId = sessionTenantOf(claims)
  if (tenantId === null) throw fail("CMS_CONNECTOR_TENANT_REQUIRED")
  const endpoint =
    parsed.data.sourceEndpoint === undefined || parsed.data.sourceEndpoint.length === 0
      ? null
      : connectorEndpointOf(parsed.data.sourceEndpoint)
  if (parsed.data.type === "rss" && endpoint === null) {
    throw fail("CMS_CONNECTOR_ENDPOINT_REQUIRED", 400, "RSS 采集源必须配置 feed 端点")
  }
  const rows = await db
    .insert(connectors)
    .values({
      name: parsed.data.name,
      pollIntervalMinutes: parsed.data.pollIntervalMinutes,
      siteId: parsed.data.site,
      sourceEndpoint: endpoint,
      status: parsed.data.status,
      tenantId,
      type: parsed.data.type,
    })
    .returning()
  const row = rows[0]
  if (row === undefined) throw fail("CMS_CONNECTOR_CREATE_FAILED", 500)
  return connectorDtoOf(row)
}

export const updateConnector = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
  input: unknown,
): Promise<Row> => {
  const parsed = connectorUpdateSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_CONNECTOR_INPUT_INVALID")
  const rows = await db.transaction(async (tx) => {
    const currentRows = await tx.select().from(connectors).where(eq(connectors.id, id)).limit(1)
    const current = currentRows[0]
    if (current === undefined) throw fail("CMS_NOT_FOUND", 404)
    assertScope(scope, current.tenantId)
    if (parsed.data.site !== undefined && parsed.data.site !== current.siteId) {
      const siteTenant = await connectorSiteTenantOf(tx, parsed.data.site)
      if (siteTenant !== current.tenantId) throw fail("CMS_CONNECTOR_TENANT_MISMATCH", 403)
    }
    const nextType = current.type
    const nextEndpoint =
      parsed.data.sourceEndpoint === undefined
        ? current.sourceEndpoint
        : parsed.data.sourceEndpoint === null || parsed.data.sourceEndpoint.length === 0
          ? null
          : connectorEndpointOf(parsed.data.sourceEndpoint)
    if (nextType === "rss" && nextEndpoint === null) {
      throw fail("CMS_CONNECTOR_ENDPOINT_REQUIRED", 400, "RSS 采集源必须配置 feed 端点")
    }
    const updated = await tx
      .update(connectors)
      .set({
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.pollIntervalMinutes === undefined
          ? {}
          : { pollIntervalMinutes: parsed.data.pollIntervalMinutes }),
        ...(parsed.data.site === undefined ? {} : { siteId: parsed.data.site }),
        ...(parsed.data.sourceEndpoint === undefined ? {} : { sourceEndpoint: nextEndpoint }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id))
      .returning()
    const row = updated[0]
    if (row === undefined) throw fail("CMS_CONNECTOR_UPDATE_FAILED", 500)
    return row
  })
  return connectorDtoOf(rows)
}

/* ---------- tenants ---------- */

const tenantSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict()

export const createTenant = async (
  db: ServerDb,
  scope: EntityScope,
  input: unknown,
): Promise<Row> => {
  const parsed = tenantSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_TENANT_INPUT_INVALID")
  if (scope.kind !== "global") throw fail("CMS_FORBIDDEN", 403)
  const rows = await db.insert(tenants).values({ name: parsed.data.name }).returning()
  const row = rows[0]
  if (row === undefined) throw fail("CMS_TENANT_CREATE_FAILED", 500)
  return (await findConsoleRecord(db, scope, "tenants", row.id)) ?? { id: row.id, name: row.name }
}

export const updateTenant = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
  input: unknown,
): Promise<Row> => {
  const parsed = tenantSchema.partial().safeParse(input)
  if (!parsed.success) throw fail("CMS_TENANT_INPUT_INVALID")
  if (scope.kind !== "global" && scope.tenantId !== id) throw fail("CMS_NOT_FOUND", 404)
  const rows = await db
    .update(tenants)
    .set({
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, id))
    .returning({ id: tenants.id })
  if (rows[0] === undefined) throw fail("CMS_NOT_FOUND", 404)
  return (await findConsoleRecord(db, scope, "tenants", id)) ?? { id }
}

/* ---------- domains ---------- */

const domainSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253),
    role: z.enum(["canonical", "alias"]).default("canonical"),
    site: z.coerce.number().int().positive(),
    status: z.enum(["active", "disabled"]).default("active"),
  })
  .strict()

const hostnameOf = (value: string): string => {
  const normalized = normalizeSiteHost(value)
  if (!normalized.ok)
    throw fail("CMS_DOMAIN_HOSTNAME_INVALID", 400, "主机名必须是有效的 DNS 主机名")
  return normalized.value.value
}

const siteTenantOf = async (tx: Tx, siteId: number): Promise<number> => {
  const rows = await tx
    .select({ tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  const tenantId = rows[0]?.tenantId
  if (tenantId === undefined) throw fail("CMS_DOMAIN_SITE_NOT_FOUND", 400)
  return tenantId
}

export const createDomain = async (
  db: ServerDb,
  scope: EntityScope,
  claims: SessionClaims,
  input: unknown,
): Promise<Row> => {
  const parsed = domainSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_DOMAIN_INPUT_INVALID")
  const hostname = hostnameOf(parsed.data.hostname)
  const id = await db.transaction(async (tx) => {
    const siteTenant = await siteTenantOf(tx, parsed.data.site)
    const tenantId = scope.kind === "global" ? siteTenant : sessionTenantOf(claims)
    if (tenantId === null || tenantId !== siteTenant) throw fail("CMS_DOMAIN_TENANT_MISMATCH")
    try {
      const rows = await tx
        .insert(domains)
        .values({
          hostname,
          role: parsed.data.role,
          siteId: parsed.data.site,
          status: parsed.data.status,
          tenantId,
        })
        .returning({ id: domains.id })
      const row = rows[0]
      if (row === undefined) throw fail("CMS_DOMAIN_CREATE_FAILED", 500)
      return row.id
    } catch (error) {
      if (isUniqueViolation(error)) throw fail("CMS_DOMAIN_HOSTNAME_TAKEN", 400, "主机名已被使用")
      throw error
    }
  })
  return (await findConsoleRecord(db, scope, "domains", id)) ?? { id }
}

export const updateDomain = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
  input: unknown,
): Promise<Row> => {
  const parsed = domainSchema.partial().safeParse(input)
  if (!parsed.success) throw fail("CMS_DOMAIN_INPUT_INVALID")
  await db.transaction(async (tx) => {
    const current = (await tx.select().from(domains).where(eq(domains.id, id)).limit(1))[0]
    if (current === undefined) throw fail("CMS_NOT_FOUND", 404)
    assertScope(scope, current.tenantId)
    const siteId = parsed.data.site ?? current.siteId
    const siteTenant = await siteTenantOf(tx, siteId)
    if (siteTenant !== current.tenantId) throw fail("CMS_DOMAIN_TENANT_MISMATCH")
    try {
      await tx
        .update(domains)
        .set({
          ...(parsed.data.hostname === undefined
            ? {}
            : { hostname: hostnameOf(parsed.data.hostname) }),
          ...(parsed.data.role === undefined ? {} : { role: parsed.data.role }),
          ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
          siteId,
          updatedAt: new Date(),
        })
        .where(eq(domains.id, id))
    } catch (error) {
      if (isUniqueViolation(error)) throw fail("CMS_DOMAIN_HOSTNAME_TAKEN", 400, "主机名已被使用")
      throw error
    }
  })
  return (await findConsoleRecord(db, scope, "domains", id)) ?? { id }
}

/* ---------- sites ---------- */

const ratio = z.coerce.number().min(0).max(1)
const percent = z.coerce.number().min(0).max(100)
const textList = z.array(z.string().trim().min(1).max(500)).max(50).default([])
const nullableText = z.string().trim().max(2000).nullable().optional()

const siteSchema = z
  .object({
    contentStrategy: z
      .object({
        contentAngles: textList,
        cta: nullableText,
        expertise: textList,
        language: nullableText,
        positioning: nullableText,
        preferredTopics: textList,
        prohibitedExpressions: textList,
        prohibitedTopics: textList,
        targetAudience: textList,
        tone: nullableText,
      })
      .strict()
      .optional(),
    locale: z.string().trim().min(2).max(64),
    name: z.string().trim().min(1).max(200),
    qualityThresholds: z
      .object({
        crossDomainBlock: ratio,
        crossDomainReview: ratio,
        dimensionMinimum: percent,
        overallMinimum: percent,
        sameSiteTitleBlock: ratio,
      })
      .strict()
      .optional(),
    seoDefaults: z
      .object({ defaultDescription: nullableText, titleSuffix: nullableText })
      .strict()
      .optional(),
    status: z.enum(["active", "disabled"]).default("active"),
    timezone: z.string().trim().min(1).max(100),
  })
  .strict()

type SiteInput = z.infer<typeof siteSchema>
type SitePatch = { readonly [K in keyof SiteInput]?: SiteInput[K] | undefined }

const siteColumnsOf = (data: SitePatch) => {
  const locale = data.locale === undefined ? undefined : normalizeLocale(data.locale)
  if (locale !== undefined && !locale.ok) {
    throw fail("CMS_SITE_LOCALE_INVALID", 400, "区域设置必须是规范的 BCP-47 标签")
  }
  const timezone = data.timezone === undefined ? undefined : validateTimezone(data.timezone)
  if (timezone !== undefined && !timezone.ok) {
    throw fail("CMS_SITE_TIMEZONE_INVALID", 400, "时区必须是规范的 IANA 时区名称")
  }
  const strategy = data.contentStrategy
  const thresholds = data.qualityThresholds
  const seo = data.seoDefaults
  return {
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(locale === undefined ? {} : { locale: locale.value.value }),
    ...(timezone === undefined ? {} : { timezone: timezone.value.value }),
    ...(data.status === undefined ? {} : { status: data.status }),
    ...(strategy === undefined
      ? {}
      : {
          contentStrategyContentAngles: strategy.contentAngles,
          contentStrategyCta: strategy.cta ?? null,
          contentStrategyExpertise: strategy.expertise,
          contentStrategyLanguage: strategy.language ?? null,
          contentStrategyPositioning: strategy.positioning ?? null,
          contentStrategyPreferredTopics: strategy.preferredTopics,
          contentStrategyProhibitedExpressions: strategy.prohibitedExpressions,
          contentStrategyProhibitedTopics: strategy.prohibitedTopics,
          contentStrategyTargetAudience: strategy.targetAudience,
          contentStrategyTone: strategy.tone ?? null,
        }),
    ...(thresholds === undefined
      ? {}
      : {
          qualityThresholdsCrossDomainBlock: String(thresholds.crossDomainBlock),
          qualityThresholdsCrossDomainReview: String(thresholds.crossDomainReview),
          qualityThresholdsDimensionMinimum: String(thresholds.dimensionMinimum),
          qualityThresholdsOverallMinimum: String(thresholds.overallMinimum),
          qualityThresholdsSameSiteTitleBlock: String(thresholds.sameSiteTitleBlock),
        }),
    ...(seo === undefined
      ? {}
      : {
          seoDefaultsDefaultDescription: seo.defaultDescription ?? null,
          seoDefaultsTitleSuffix: seo.titleSuffix ?? null,
        }),
  }
}

export const createSite = async (
  db: ServerDb,
  scope: EntityScope,
  claims: SessionClaims,
  input: unknown,
): Promise<Row> => {
  const parsed = siteSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_SITE_INPUT_INVALID", 400, parsed.error.issues[0]?.message)
  const tenantId = sessionTenantOf(claims)
  if (tenantId === null) throw fail("CMS_SITE_TENANT_REQUIRED")
  const columns = siteColumnsOf(parsed.data)
  const id = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(sites)
      .values({
        locale: columns.locale ?? parsed.data.locale,
        name: parsed.data.name,
        status: parsed.data.status,
        tenantId,
        timezone: columns.timezone ?? parsed.data.timezone,
        ...columns,
      })
      .returning({ id: sites.id })
    const row = rows[0]
    if (row === undefined) throw fail("CMS_SITE_CREATE_FAILED", 500)
    return row.id
  })
  return (await findConsoleRecord(db, scope, "sites", id)) ?? { id }
}

export const updateSite = async (
  db: ServerDb,
  scope: EntityScope,
  id: number,
  input: unknown,
): Promise<Row> => {
  const parsed = siteSchema.partial().safeParse(input)
  if (!parsed.success) throw fail("CMS_SITE_INPUT_INVALID", 400, parsed.error.issues[0]?.message)
  const columns = siteColumnsOf(parsed.data)
  await db.transaction(async (tx) => {
    const current = (
      await tx.select({ tenantId: sites.tenantId }).from(sites).where(eq(sites.id, id)).limit(1)
    )[0]
    if (current === undefined) throw fail("CMS_NOT_FOUND", 404)
    assertScope(scope, current.tenantId)
    await tx
      .update(sites)
      .set({ ...columns, updatedAt: new Date() })
      .where(eq(sites.id, id))
  })
  return (await findConsoleRecord(db, scope, "sites", id)) ?? { id }
}

/* ---------- users ---------- */

const userSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(200).optional(),
    role: z.enum(CMS_ROLES as unknown as [string, ...string[]]),
    sites: z.array(z.coerce.number().int().positive()).optional(),
    tenant: z.coerce.number().int().positive().optional(),
  })
  .strict()

const tenantBindingOf = (
  claims: SessionClaims,
  role: string,
  requested: number | undefined,
): number | null => {
  if (role === CMS_ROLE.SUPER_ADMIN) return null
  if (claims.role === CMS_ROLE.SUPER_ADMIN) return requested ?? null
  return sessionTenantOf(claims)
}

export const createUser = async (
  db: ServerDb,
  scope: EntityScope,
  claims: SessionClaims,
  input: unknown,
): Promise<Row> => {
  const parsed = userSchema.safeParse(input)
  if (!parsed.success) throw fail("CMS_USER_INPUT_INVALID", 400, parsed.error.issues[0]?.message)
  if (parsed.data.password === undefined) throw fail("CMS_USER_PASSWORD_REQUIRED")
  const role = resolveRoleAssignment({ claims, incoming: parsed.data.role, usersEmpty: false })
  if (role === null) throw fail("CMS_USER_ROLE_FORBIDDEN", 403)
  const tenantId = tenantBindingOf(claims, role, parsed.data.tenant)
  const invariant = validateUserTenantInvariant({
    existingRole: undefined,
    existingTenant: undefined,
    incomingRole: role,
    incomingTenant: tenantId,
  })
  if (invariant !== true) throw fail("CMS_USER_TENANT_REQUIRED")
  const credentials = await hashPassword(parsed.data.password)
  try {
    const rows = await db
      .insert(users)
      .values({
        email: parsed.data.email.toLowerCase(),
        hash: credentials.hash,
        role,
        salt: credentials.salt,
        tenantId,
      })
      .returning({ id: users.id })
    const row = rows[0]
    if (row === undefined) throw fail("CMS_USER_CREATE_FAILED", 500)
    return (await findConsoleRecord(db, scope, "users", row.id)) ?? { id: row.id }
  } catch (error) {
    if (isUniqueViolation(error)) throw fail("CMS_USER_EMAIL_TAKEN", 400, "该邮箱已被使用")
    throw error
  }
}

export const updateUser = async (
  db: ServerDb,
  scope: EntityScope,
  claims: SessionClaims,
  id: number,
  input: unknown,
): Promise<Row> => {
  const parsed = userSchema.partial().safeParse(input)
  if (!parsed.success) throw fail("CMS_USER_INPUT_INVALID", 400, parsed.error.issues[0]?.message)
  const current = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]
  if (current === undefined) throw fail("CMS_NOT_FOUND", 404)
  assertScope(scope, current.tenantId)
  const role =
    parsed.data.role === undefined
      ? current.role
      : resolveRoleAssignment({
          claims,
          incoming: parsed.data.role,
          originalRole: current.role,
          originalUserId: current.id,
          usersEmpty: false,
        })
  if (role === null) throw fail("CMS_USER_ROLE_FORBIDDEN", 403)
  const tenantId =
    role === CMS_ROLE.SUPER_ADMIN
      ? null
      : claims.role === CMS_ROLE.SUPER_ADMIN
        ? (parsed.data.tenant ?? current.tenantId)
        : sessionTenantOf(claims)
  const invariant = validateUserTenantInvariant({
    existingRole: current.role,
    existingTenant: current.tenantId,
    incomingRole: role,
    incomingTenant: tenantId,
  })
  if (invariant !== true) throw fail("CMS_USER_TENANT_REQUIRED")
  const credentials =
    parsed.data.password === undefined ? null : await hashPassword(parsed.data.password)
  try {
    await db
      .update(users)
      .set({
        ...(parsed.data.email === undefined ? {} : { email: parsed.data.email.toLowerCase() }),
        ...(credentials === null ? {} : { hash: credentials.hash, salt: credentials.salt }),
        role,
        tenantId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
  } catch (error) {
    if (isUniqueViolation(error)) throw fail("CMS_USER_EMAIL_TAKEN", 400, "该邮箱已被使用")
    throw error
  }
  return (await findConsoleRecord(db, scope, "users", id)) ?? { id }
}

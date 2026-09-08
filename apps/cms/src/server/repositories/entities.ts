/*
 * 基础实体只读仓储：显式 scope + Payload 兼容分页 DTO。
 * 首批只接当前 Console 已实际使用的查询形态；遇到不支持的 where 由路由回退
 * Payload，绝不静默忽略过滤条件。
 */

import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"

import { CMS_ROLE } from "../../access/roles"
import type { AuthenticatedRequest } from "../auth/session"
import type { ServerDb } from "../db/client"
import { sites } from "../db/entity-schema"
import { tenants } from "../db/schema"

export type EntityScope =
  | Readonly<{ kind: "global" }>
  | Readonly<{ kind: "tenant"; tenantId: number }>
  | Readonly<{ kind: "site"; siteIds: readonly number[]; tenantId: number }>

export const entityScopeFor = (
  input: Readonly<{
    role: AuthenticatedRequest["claims"]["role"]
    siteIds: readonly number[]
    tenantId: string | number | null
  }>,
  options: Readonly<{ applySiteScope?: boolean }> = {},
): EntityScope | null => {
  if (input.role === CMS_ROLE.SUPER_ADMIN) return { kind: "global" }
  const tenantId = Number(input.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return null
  /* users.sites 是 Console 显示收窄，不是 Payload collection access 的安全边界。
   * 通用 /api/sites 兼容路由默认维持租户级语义；特定 UI 查询可显式开启。 */
  if (
    options.applySiteScope === true &&
    input.role !== CMS_ROLE.TENANT_ADMIN &&
    input.siteIds.length > 0
  ) {
    return { kind: "site", siteIds: input.siteIds, tenantId }
  }
  return { kind: "tenant", tenantId }
}

export const entityScopeOf = (
  auth: AuthenticatedRequest,
  options: Readonly<{ applySiteScope?: boolean }> = {},
): EntityScope | null =>
  entityScopeFor(
    {
      role: auth.claims.role,
      siteIds: auth.siteIds,
      tenantId: auth.claims.tenantId,
    },
    options,
  )

export type ListInput = Readonly<{
  ids?: readonly number[]
  limit: number
  page: number
  sort: "createdAt" | "name" | "updatedAt" | "-createdAt" | "-name" | "-updatedAt"
  tenantId?: number
}>

export type PayloadPage<T> = Readonly<{
  docs: readonly T[]
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
  nextPage: number | null
  page: number
  pagingCounter: number
  prevPage: number | null
  totalDocs: number
  totalPages: number
}>

const pageOf = <T>(docs: readonly T[], totalDocs: number, input: ListInput): PayloadPage<T> => {
  const totalPages = Math.max(1, Math.ceil(totalDocs / input.limit))
  return {
    docs,
    hasNextPage: input.page < totalPages,
    hasPrevPage: input.page > 1,
    limit: input.limit,
    nextPage: input.page < totalPages ? input.page + 1 : null,
    page: input.page,
    pagingCounter: (input.page - 1) * input.limit + 1,
    prevPage: input.page > 1 ? input.page - 1 : null,
    totalDocs,
    totalPages,
  }
}

export const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const effectiveTenant = (scope: EntityScope, requested?: number): number | null => {
  if (scope.kind === "global") return requested ?? null
  if (requested !== undefined && requested !== scope.tenantId) return -1
  return scope.tenantId
}

const sortOf = (
  input: ListInput,
  columns: Readonly<Record<"createdAt" | "name" | "updatedAt", Parameters<typeof asc>[0]>>,
): SQL => {
  const descending = input.sort.startsWith("-")
  const name = input.sort.replace("-", "") as "createdAt" | "name" | "updatedAt"
  return (descending ? desc : asc)(columns[name])
}

export class EntitiesRepository {
  constructor(private readonly db: ServerDb) {}

  async tenantName(id: number): Promise<string | null> {
    const rows = await this.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1)
    return rows[0]?.name ?? null
  }

  async listTenants(
    scope: EntityScope,
    input: ListInput,
  ): Promise<PayloadPage<Record<string, unknown>>> {
    const where =
      scope.kind === "global"
        ? input.ids === undefined
          ? undefined
          : inArray(tenants.id, [...input.ids])
        : input.ids !== undefined && !input.ids.includes(scope.tenantId)
          ? eq(tenants.id, -1)
          : eq(tenants.id, scope.tenantId)
    const docs = await this.db
      .select()
      .from(tenants)
      .where(where)
      .orderBy(
        sortOf(input, {
          createdAt: tenants.createdAt,
          name: tenants.name,
          updatedAt: tenants.updatedAt,
        }),
      )
      .limit(input.limit)
      .offset((input.page - 1) * input.limit)
    const all = await this.db.select({ id: tenants.id }).from(tenants).where(where)
    return pageOf(
      docs.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt.toISOString(),
      })),
      all.length,
      input,
    )
  }

  async listSites(
    scope: EntityScope,
    input: ListInput,
  ): Promise<PayloadPage<Record<string, unknown>>> {
    const tenantId = effectiveTenant(scope, input.tenantId)
    const predicates = [
      ...(tenantId === null ? [] : [eq(sites.tenantId, tenantId)]),
      ...(scope.kind === "site" ? [inArray(sites.id, [...scope.siteIds])] : []),
      ...(input.ids === undefined ? [] : [inArray(sites.id, [...input.ids])]),
    ]
    const where = predicates.length === 0 ? undefined : and(...predicates)
    const docs = await this.db
      .select()
      .from(sites)
      .where(where)
      .orderBy(
        sortOf(input, { createdAt: sites.createdAt, name: sites.name, updatedAt: sites.updatedAt }),
      )
      .limit(input.limit)
      .offset((input.page - 1) * input.limit)
    const all = await this.db.select({ id: sites.id }).from(sites).where(where)
    return pageOf(
      docs.map((row) => {
        return {
          contentStrategy: {
            contentAngles: stringList(row.contentStrategyContentAngles),
            cta: row.contentStrategyCta,
            expertise: stringList(row.contentStrategyExpertise),
            language: row.contentStrategyLanguage,
            positioning: row.contentStrategyPositioning,
            preferredTopics: stringList(row.contentStrategyPreferredTopics),
            prohibitedExpressions: stringList(row.contentStrategyProhibitedExpressions),
            prohibitedTopics: stringList(row.contentStrategyProhibitedTopics),
            targetAudience: stringList(row.contentStrategyTargetAudience),
            tone: row.contentStrategyTone,
          },
          createdAt: row.createdAt.toISOString(),
          id: row.id,
          locale: row.locale,
          name: row.name,
          qualityThresholds: {
            crossDomainBlock: Number(row.qualityThresholdsCrossDomainBlock ?? 0.92),
            crossDomainReview: Number(row.qualityThresholdsCrossDomainReview ?? 0.85),
            dimensionMinimum: Number(row.qualityThresholdsDimensionMinimum ?? 75),
            overallMinimum: Number(row.qualityThresholdsOverallMinimum ?? 80),
            sameSiteTitleBlock: Number(row.qualityThresholdsSameSiteTitleBlock ?? 0.9),
          },
          seoDefaults: {
            defaultDescription: row.seoDefaultsDefaultDescription,
            titleSuffix: row.seoDefaultsTitleSuffix,
          },
          status: row.status,
          tenant: row.tenantId,
          timezone: row.timezone,
          updatedAt: row.updatedAt.toISOString(),
        }
      }),
      all.length,
      input,
    )
  }
}

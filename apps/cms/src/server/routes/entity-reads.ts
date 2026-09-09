/*
 * 基础集合 GET 的只读接管。
 *
 * 返回 null 表示「不属于支持的精确列表查询」，由 API 网关继续匹配其他
 * 自建处理器；返回 Response 表示已由 Drizzle 完整处理。
 */

import { CMS_ACTION, CMS_RESOURCE, type CmsResource, decideAccess } from "../../access/policy"
import { authenticateRequest } from "../auth/session"
import { EntitiesRepository, entityScopeOf, type ListInput } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const SUPPORTED = {
  sites: CMS_RESOURCE.SITES,
  tenants: CMS_RESOURCE.TENANTS,
} as const

type SupportedSlug = keyof typeof SUPPORTED

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const numberOf = (value: string | null, fallback: number, max: number): number | null => {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null
}

const idsOf = (value: string | null): readonly number[] | null => {
  if (value === null) return []
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) return null
  return parts.map(Number)
}

export const parseEntityListQuery = (url: URL): ListInput | null => {
  const allowed = new Set([
    "depth",
    "limit",
    "page",
    "sort",
    "where[id][in]",
    "where[tenant][equals]",
  ])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return null
  }
  const depth = url.searchParams.get("depth")
  if (depth !== null && depth !== "0") return null
  const limit = numberOf(url.searchParams.get("limit"), 10, 100)
  const page = numberOf(url.searchParams.get("page"), 1, 100_000)
  if (limit === null || page === null) return null
  const sort = url.searchParams.get("sort") ?? "-createdAt"
  if (
    sort !== "createdAt" &&
    sort !== "-createdAt" &&
    sort !== "updatedAt" &&
    sort !== "-updatedAt" &&
    sort !== "name" &&
    sort !== "-name"
  ) {
    return null
  }
  const ids = idsOf(url.searchParams.get("where[id][in]"))
  if (ids === null) return null
  const tenantRaw = url.searchParams.get("where[tenant][equals]")
  if (tenantRaw !== null && !/^\d+$/.test(tenantRaw)) return null
  return {
    ...(ids.length === 0 ? {} : { ids }),
    limit,
    page,
    sort,
    ...(tenantRaw === null ? {} : { tenantId: Number(tenantRaw) }),
  }
}

export const handleEntityListGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 1) return null
  const firstSegment = slug[0]
  if (firstSegment === undefined || !(firstSegment in SUPPORTED)) return null
  const collection = firstSegment as SupportedSlug
  const input = parseEntityListQuery(new URL(request.url))
  if (input === null) return null

  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { errors: [{ message: "Unauthorized" }] })
  const resource: CmsResource = SUPPORTED[collection]
  if (!decideAccess(auth.claims, resource, CMS_ACTION.READ)) {
    return json(403, { errors: [{ message: "You are not allowed to perform this action." }] })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { errors: [{ message: "Forbidden" }] })

  const repository = new EntitiesRepository(serverRuntime().db)
  switch (collection) {
    case "sites":
      return json(200, await repository.listSites(scope, input))
    case "tenants":
      return json(200, await repository.listTenants(scope, input))
  }
}

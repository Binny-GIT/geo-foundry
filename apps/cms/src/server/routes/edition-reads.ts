/* content-editions draft=true&depth=0 的 Markdown-first Drizzle 读取接管。 */

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { authenticateRequest } from "../auth/session"
import { EditionsRepository, type EditionListInput } from "../repositories/editions"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const WORKFLOW = new Set([
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
])

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const positiveInt = (value: string | null, fallback: number, max: number): number | null => {
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

export const parseEditionListQuery = (url: URL): EditionListInput | null => {
  const allowed = new Set([
    "depth",
    "draft",
    "limit",
    "page",
    "sort",
    "where[id][in]",
    "where[site][equals]",
    "where[tenant][equals]",
    "where[title][like]",
    "where[workflowStatus][equals]",
  ])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return null
  }
  if (url.searchParams.get("draft") !== "true") return null
  const depth = url.searchParams.get("depth")
  if (depth !== null && depth !== "0") return null
  const limit = positiveInt(url.searchParams.get("limit"), 10, 100)
  const page = positiveInt(url.searchParams.get("page"), 1, 100_000)
  if (limit === null || page === null) return null
  const sort = url.searchParams.get("sort") ?? "-updatedAt"
  if (
    sort !== "createdAt" &&
    sort !== "-createdAt" &&
    sort !== "updatedAt" &&
    sort !== "-updatedAt" &&
    sort !== "title" &&
    sort !== "-title"
  )
    return null
  const ids = idsOf(url.searchParams.get("where[id][in]"))
  if (ids === null) return null
  const siteRaw = url.searchParams.get("where[site][equals]")
  const tenantRaw = url.searchParams.get("where[tenant][equals]")
  if (siteRaw !== null && !/^\d+$/.test(siteRaw)) return null
  if (tenantRaw !== null && !/^\d+$/.test(tenantRaw)) return null
  const status = url.searchParams.get("where[workflowStatus][equals]")
  if (status !== null && !WORKFLOW.has(status)) return null
  const query = url.searchParams.get("where[title][like]")?.trim()
  return {
    ...(ids.length === 0 ? {} : { ids }),
    limit,
    page,
    ...(query === undefined || query.length === 0 ? {} : { query }),
    ...(siteRaw === null ? {} : { siteId: Number(siteRaw) }),
    sort,
    ...(status === null ? {} : { status }),
    ...(tenantRaw === null ? {} : { tenantId: Number(tenantRaw) }),
  }
}

const authorize = async (request: Request) => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return { response: json(401, { errors: [{ message: "Unauthorized" }] }) }
  if (!decideAccess(auth.claims, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) {
    return {
      response: json(403, { errors: [{ message: "You are not allowed to perform this action." }] }),
    }
  }
  const scope = entityScopeOf(auth)
  return scope === null
    ? { response: json(403, { errors: [{ message: "Forbidden" }] }) }
    : { scope }
}

export const handleEditionDraftGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.[0] !== "content-editions" || (slug.length !== 1 && slug.length !== 2)) return null
  const url = new URL(request.url)
  if (url.searchParams.get("draft") !== "true") return null
  const depth = url.searchParams.get("depth")
  if (depth !== null && depth !== "0") return null

  const authorized = await authorize(request)
  if ("response" in authorized) return authorized.response
  const repository = new EditionsRepository(serverRuntime().db)

  if (slug.length === 2) {
    const id = slug[1]
    if (id === undefined || !/^\d+$/.test(id) || Number(id) <= 0) return null
    const document = await repository.findDraft(authorized.scope, Number(id))
    return document === null
      ? json(404, { errors: [{ message: "The requested resource could not be found." }] })
      : json(200, document)
  }

  const input = parseEditionListQuery(url)
  return input === null ? null : json(200, await repository.listDrafts(authorized.scope, input))
}

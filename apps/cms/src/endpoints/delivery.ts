import type { Endpoint, PayloadRequest } from "payload"

/**
 * Public read-only delivery API for owned brand websites.
 *
 * Only published editions of sites with an active canonical domain are
 * exposed; responses are field-whitelisted so internal ledger data never
 * leaks. Usage is recorded as a daily aggregate for the Console stats page.
 * The published content itself is already public once released, so these
 * endpoints require no session — abuse is bounded by a per-IP rate limit.
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

const rateLimited = (requestId: string): boolean => {
  const now = Date.now()
  const bucket = rateBuckets.get(requestId)
  if (bucket === undefined || bucket.resetAt <= now) {
    rateBuckets.set(requestId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX
}

const json = (status: number, body: unknown, cacheSeconds?: number): Response => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" })
  if (cacheSeconds !== undefined) {
    headers.set("cache-control", `public, max-age=${cacheSeconds}`)
  }
  return new Response(JSON.stringify(body), { headers, status })
}

const clientKeyOf = (req: PayloadRequest): string =>
  req.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"

type DomainRow = { siteId: number; tenantId: number | null }

const activeCanonicalSite = async (
  req: PayloadRequest,
  domain: string,
): Promise<DomainRow | null> => {
  const normalized = domain.toLowerCase().trim()
  if (normalized.length === 0 || !/^[a-z0-9.-]+$/.test(normalized)) return null
  const found = await req.payload.find({
    collection: "domains",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { hostname: { equals: normalized } },
        { role: { equals: "canonical" } },
        { status: { equals: "active" } },
      ],
    },
  })
  const domainDoc = found.docs[0] as unknown as Record<string, unknown> | undefined
  if (domainDoc === undefined) return null
  const site = domainDoc["site"]
  const siteId =
    typeof site === "object" && site !== null ? (site as Record<string, unknown>)["id"] : site
  if (typeof siteId !== "number") return null
  const siteDoc = (await req.payload.findByID({
    collection: "sites",
    depth: 0,
    id: siteId,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
  if (siteDoc["status"] !== "active") return null
  const tenant = siteDoc["tenant"]
  const tenantId =
    typeof tenant === "object" && tenant !== null
      ? (((tenant as Record<string, unknown>)["id"] as number | undefined) ?? null)
      : typeof tenant === "number"
        ? tenant
        : null
  return { siteId, tenantId }
}

const recordUsage = (
  req: PayloadRequest,
  route: "article" | "articles",
  siteId: number,
  tenantId: number | null,
): void => {
  const date = new Date().toISOString().slice(0, 10)
  void (async () => {
    try {
      const existing = await req.payload.find({
        collection: "api-usage-dailies",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: {
          and: [
            { date: { equals: date } },
            { route: { equals: route } },
            { siteId: { equals: siteId } },
          ],
        },
      })
      const row = existing.docs[0] as unknown as Record<string, unknown> | undefined
      if (row === undefined) {
        await req.payload.create({
          collection: "api-usage-dailies",
          data: { count: 1, date, route, siteId, tenantId: tenantId ?? 0 },
          depth: 0,
          overrideAccess: true,
        })
        return
      }
      await req.payload.update({
        collection: "api-usage-dailies",
        id: row["id"] as number,
        data: { count: ((row["count"] as number | undefined) ?? 0) + 1 },
        depth: 0,
        overrideAccess: true,
      })
    } catch {
      // Usage aggregation must never break delivery.
    }
  })()
}

const activePathnameByContent = async (
  req: PayloadRequest,
  siteId: number,
): Promise<Map<number, string>> => {
  const map = new Map<number, string>()
  const records = await req.payload.find({
    collection: "url-records",
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      and: [{ site: { equals: siteId } }, { state: { equals: "active" } }],
    },
  })
  for (const record of records.docs as unknown as Record<string, unknown>[]) {
    const content = record["content"]
    const contentId =
      typeof content === "object" && content !== null
        ? (content as Record<string, unknown>)["id"]
        : content
    const pathname = record["pathname"]
    if (typeof contentId === "number" && typeof pathname === "string" && pathname.length > 0) {
      if (!map.has(contentId)) map.set(contentId, pathname)
    }
  }
  return map
}

const publicEdition = (
  edition: Record<string, unknown>,
  pathname: string | undefined,
): Record<string, unknown> => ({
  id: edition["id"],
  publishedAt: edition["createdAt"],
  summary: edition["summary"],
  title: edition["title"],
  updatedAt: edition["updatedAt"],
  ...(pathname === undefined ? {} : { pathname, url: pathname }),
})

export const deliveryArticlesEndpoint: Endpoint = {
  handler: async (req) => {
    if (rateLimited(clientKeyOf(req)))
      return json(429, { error: { code: "DELIVERY_RATE_LIMITED" } })
    const domain = String(req.routeParams?.["domain"] ?? "")
    const site = await activeCanonicalSite(req, domain)
    if (site === null) return json(404, { error: { code: "DELIVERY_SITE_NOT_FOUND" } }, 60)

    const url = new URL(req.url ?? "http://local")
    const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1)
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10)
    const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100)

    const [editions, pathnames] = await Promise.all([
      req.payload.find({
        collection: "content-editions",
        depth: 0,
        limit,
        overrideAccess: true,
        page,
        sort: "-createdAt",
        where: {
          and: [
            /*
             * 多站点分配：主站点（发布链路）或 sites 集合命中均可读取——
             * 分配了就能读到，没分配就读取不到。
             */
            {
              or: [
                { site: { equals: site.siteId } },
                { sites: { contains: site.siteId } },
              ],
            },
            { workflowStatus: { equals: "published" } },
            ...(q.length === 0 ? [] : [{ title: { like: q } }]),
          ],
        },
      }),
      activePathnameByContent(req, site.siteId),
    ])

    recordUsage(req, "articles", site.siteId, site.tenantId)

    const contentIdOf = (edition: Record<string, unknown>): number | null => {
      const content = edition["content"]
      if (typeof content === "number") return content
      if (typeof content === "object" && content !== null) {
        const id = (content as Record<string, unknown>)["id"]
        if (typeof id === "number") return id
      }
      return null
    }

    return json(
      200,
      {
        docs: (editions.docs as unknown as Record<string, unknown>[]).map((edition) =>
          publicEdition(edition, pathnames.get(contentIdOf(edition) ?? -1)),
        ),
        page: editions.page ?? page,
        totalDocs: editions.totalDocs ?? 0,
        totalPages: editions.totalPages ?? 0,
      },
      60,
    )
  },
  method: "get",
  path: "/delivery/sites/:domain/articles",
}

export const deliveryArticleEndpoint: Endpoint = {
  handler: async (req) => {
    if (rateLimited(clientKeyOf(req)))
      return json(429, { error: { code: "DELIVERY_RATE_LIMITED" } })
    const id = Number(req.routeParams?.["id"])
    if (!Number.isSafeInteger(id) || id <= 0) {
      return json(400, { error: { code: "DELIVERY_ARTICLE_ID_INVALID" } })
    }
    let edition: Record<string, unknown>
    try {
      edition = (await req.payload.findByID({
        collection: "content-editions",
        depth: 0,
        id,
        overrideAccess: true,
      })) as unknown as Record<string, unknown>
    } catch {
      return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
    }
    if (edition["workflowStatus"] !== "published") {
      return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
    }
    /*
     * 多站点归属：主站点或 sites 集合命中任一激活站点即可交付。
     */
    const siteRef = edition["site"]
    const primarySiteId =
      typeof siteRef === "object" && siteRef !== null
        ? (siteRef as Record<string, unknown>)["id"]
        : siteRef
    const assignedIds = [
      ...(typeof primarySiteId === "number" ? [primarySiteId] : []),
      ...(Array.isArray(edition["sites"])
        ? edition["sites"].flatMap((entry) => {
            const id =
              typeof entry === "object" && entry !== null
                ? (entry as Record<string, unknown>)["id"]
                : entry
            return typeof id === "number" ? [id] : []
          })
        : []),
    ].filter((id, index, all) => all.indexOf(id) === index)
    if (assignedIds.length === 0) {
      return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
    }
    const activeSite = (
      await Promise.all(
        assignedIds.map((id) =>
          req.payload
            .findByID({ collection: "sites", depth: 0, id, overrideAccess: true })
            .then((doc) => (doc as Record<string, unknown>)["status"] === "active" ? id : null)
            .catch(() => null),
        ),
      )
    ).find((id): id is number => id !== null)
    if (activeSite === undefined) {
      return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
    }
    const siteId = activeSite
    const siteDoc = (await req.payload.findByID({
      collection: "sites",
      depth: 0,
      id: siteId,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    if (siteDoc["status"] !== "active") {
      return json(404, { error: { code: "DELIVERY_ARTICLE_NOT_FOUND" } }, 60)
    }
    const content = edition["content"]
    const contentId =
      typeof content === "number"
        ? content
        : typeof content === "object" && content !== null
          ? ((content as Record<string, unknown>)["id"] as number | undefined)
          : undefined
    const pathnames = await activePathnameByContent(req, siteId)
    recordUsage(req, "article", siteId, null)

    return json(
      200,
      {
        ...publicEdition(edition, contentId === undefined ? undefined : pathnames.get(contentId)),
        body: edition["body"],
        locale: edition["locale"] ?? siteDoc["locale"],
      },
      60,
    )
  },
  method: "get",
  path: "/delivery/articles/:id",
}

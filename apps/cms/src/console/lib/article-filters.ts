/**
 * Server-side whitelist for the article list filters. Search params are only
 * translated into a typed query through this module — the repository maps it
 * to SQL predicates; the client never supplies arbitrary query structures.
 */

export const ARTICLE_STATUS_OPTIONS = [
  { key: "draft", label: "草稿" },
  { key: "generating", label: "生成中" },
  { key: "review", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "compiled", label: "已编译" },
  { key: "published", label: "已发布" },
  { key: "archived", label: "已删除" },
] as const

const STATUS_KEYS: readonly string[] = ARTICLE_STATUS_OPTIONS.map((option) => option.key)

export type ArticleListQuery = {
  readonly page: number
  readonly q: string | null
  readonly site: number | null
  readonly status: string | null
  readonly tenant: number | null
}

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

const positiveInt = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export const parseArticleListQuery = (
  searchParams: Record<string, string | string[] | undefined>,
): ArticleListQuery => {
  const page = positiveInt(first(searchParams["page"])) ?? 1
  const statusRaw = first(searchParams["status"])
  const qRaw = first(searchParams["q"])?.trim() ?? ""
  return {
    page,
    q: qRaw.length === 0 ? null : qRaw.slice(0, 100),
    site: positiveInt(first(searchParams["site"])),
    status: statusRaw !== null && STATUS_KEYS.includes(statusRaw) ? statusRaw : null,
    tenant: positiveInt(first(searchParams["tenant"])),
  }
}

export const articleListHref = (
  query: ArticleListQuery,
  overrides: Partial<Omit<ArticleListQuery, "page">> & { page?: number } = {},
): string => {
  const merged = { ...query, ...overrides }
  const params = new URLSearchParams()
  if (merged.site !== null) params.set("site", String(merged.site))
  if (merged.status !== null) params.set("status", merged.status)
  if (merged.q !== null) params.set("q", merged.q)
  if (merged.tenant !== null) params.set("tenant", String(merged.tenant))
  if (merged.page > 1) params.set("page", String(merged.page))
  const search = params.toString()
  return search.length === 0
    ? "/admin/collections/content-editions"
    : `/admin/collections/content-editions?${search}`
}

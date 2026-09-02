import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  ARTICLE_STATUS_OPTIONS,
  type ArticleListQuery,
  articleListHref,
} from "@/console/lib/article-filters"
import { consoleRoute } from "@/console/lib/resources"

type RecordLike = Record<string, unknown>

export type FilterOption = {
  readonly id: number
  readonly name: string
}

const relationText = (value: unknown, field: string): string | null => {
  if (typeof value !== "object" || value === null) return null
  const text = (value as RecordLike)[field]
  return typeof text === "string" && text.length > 0 ? text : null
}

const STATUS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ARTICLE_STATUS_OPTIONS.map((option) => [option.key, option.label]),
)

const formatInstant = (value: unknown): string => {
  if (typeof value !== "string") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date)
}

const inputClass =
  "gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"

export const EditionsWorkspace = ({
  docs,
  isSuperAdmin,
  page,
  query,
  siteOptions,
  tenantOptions,
  totalDocs,
  totalPages,
}: {
  readonly docs: readonly RecordLike[]
  readonly isSuperAdmin: boolean
  readonly page: number
  readonly query: ArticleListQuery
  readonly siteOptions: readonly FilterOption[]
  readonly tenantOptions: readonly FilterOption[]
  readonly totalDocs: number
  readonly totalPages: number
}) => (
  <section className="gf-console-card overflow-hidden">
    <form
      action="/admin/collections/content-editions"
      className="grid gap-3 border-b border-[var(--console-border)] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,180px))_auto]"
      method="get"
    >
      <input
        aria-label="标题搜索"
        className={inputClass}
        defaultValue={query.q ?? ""}
        maxLength={100}
        name="q"
        placeholder="搜索标题…"
        type="search"
      />
      <select
        aria-label="站点筛选"
        className={inputClass}
        defaultValue={query.site === null ? "" : String(query.site)}
        name="site"
      >
        <option value="">全部站点</option>
        {siteOptions.map((site) => (
          <option key={site.id} value={String(site.id)}>
            {site.name}
          </option>
        ))}
      </select>
      <select
        aria-label="状态筛选"
        className={inputClass}
        defaultValue={query.status ?? ""}
        name="status"
      >
        <option value="">全部状态</option>
        {ARTICLE_STATUS_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {isSuperAdmin ? (
        <select
          aria-label="租户筛选"
          className={inputClass}
          defaultValue={query.tenant === null ? "" : String(query.tenant)}
          name="tenant"
        >
          <option value="">全部租户</option>
          {tenantOptions.map((tenant) => (
            <option key={tenant.id} value={String(tenant.id)}>
              {tenant.name}
            </option>
          ))}
        </select>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button size="md" type="submit">
          筛选
        </Button>
        <Button asChild size="md" type="button" variant="secondary">
          <Link
            href={articleListHref({
              ...query,
              page: 1,
              q: null,
              site: null,
              status: null,
              tenant: null,
            })}
          >
            重置
          </Link>
        </Button>
      </div>
    </form>

    {docs.length === 0 ? (
      <div className="grid min-h-64 place-items-center px-5 text-center">
        <div className="grid max-w-sm gap-2">
          <strong className="text-sm text-[var(--console-ink)]">当前筛选范围内没有文章</strong>
          <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
            这表示服务端在当前筛选与会话范围内没有返回数据，不代表其他租户或受限资源为空。
          </span>
        </div>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="bg-[var(--console-surface-muted)]">
            <tr>
              {[
                "标题",
                "站点",
                "状态",
                "负责人",
                ...(isSuperAdmin ? ["租户"] : []),
                "更新时间",
              ].map((label) => (
                <th
                  className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--console-ink-muted)]"
                  key={label}
                  scope="col"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map((doc, index) => {
              const id = doc["id"]
              const title =
                typeof doc["title"] === "string" && doc["title"].length > 0
                  ? doc["title"]
                  : "未命名稿件"
              const status = typeof doc["workflowStatus"] === "string" ? doc["workflowStatus"] : ""
              return (
                <tr
                  className="transition-colors hover:bg-[var(--console-surface-muted)]"
                  key={String(id ?? index)}
                >
                  <td className="max-w-[320px] border-b border-[var(--console-border)] px-5 py-4 text-sm">
                    <Link
                      className="gf-console-focus block truncate font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                      href={consoleRoute.document("content-editions", String(id))}
                    >
                      {title}
                    </Link>
                  </td>
                  <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                    {relationText(doc["site"], "name") ?? "受限站点"}
                  </td>
                  <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                      {STATUS_LABELS[status] ?? status}
                    </span>
                  </td>
                  <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                    {relationText(doc["owner"], "email") ?? "未分配"}
                  </td>
                  {isSuperAdmin && (
                    <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                      {relationText(doc["tenant"], "name") ?? "—"}
                    </td>
                  )}
                  <td className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink-muted)]">
                    {formatInstant(doc["updatedAt"])}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )}

    <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <span className="text-xs text-[var(--console-ink-muted)]">
        共 {totalDocs} 篇 · 第 {page} / {Math.max(totalPages, 1)} 页
      </span>
      <div className="flex gap-2">
        {page <= 1 ? (
          <Button disabled size="sm" type="button" variant="secondary">
            上一页
          </Button>
        ) : (
          <Button asChild size="sm" type="button" variant="secondary">
            <Link href={articleListHref(query, { page: page - 1 })}>上一页</Link>
          </Button>
        )}
        {page >= totalPages ? (
          <Button disabled size="sm" type="button" variant="secondary">
            下一页
          </Button>
        ) : (
          <Button asChild size="sm" type="button" variant="secondary">
            <Link href={articleListHref(query, { page: page + 1 })}>下一页</Link>
          </Button>
        )}
      </div>
    </footer>
  </section>
)

export default EditionsWorkspace

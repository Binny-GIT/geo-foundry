import Link from "next/link"

import { consoleRoute } from "@/console/lib/resources"

export type SiteRow = {
  readonly articleCount: number
  readonly id: number
  readonly lastPublishedAt: string | null
  readonly locale: string | null
  readonly name: string
  readonly status: string | null
  readonly tenantName: string | null
}

const formatInstant = (value: string | null): string => {
  if (value === null) return "—"
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

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "启用",
  disabled: "停用",
}

export const SitesWorkspace = ({
  isSuperAdmin,
  page,
  rows,
  totalPages,
}: {
  readonly isSuperAdmin: boolean
  readonly page: number
  readonly rows: readonly SiteRow[]
  readonly totalPages: number
}) => (
  <section className="gf-console-card overflow-hidden">
    {rows.length === 0 ? (
      <div className="grid min-h-64 place-items-center px-5 text-center">
        <div className="grid max-w-sm gap-2">
          <strong className="text-sm text-[var(--console-ink)]">当前范围内没有站点</strong>
          <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
            这表示服务端在当前会话范围内没有返回数据，不代表其他租户或受限资源为空。
          </span>
        </div>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="bg-[var(--console-surface-muted)]">
            <tr>
              {[
                "站点",
                "状态",
                "文章数",
                "最近发布",
                ...(isSuperAdmin ? ["租户"] : []),
                "操作",
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
            {rows.map((row) => (
              <tr className="transition-colors hover:bg-indigo-50/45" key={row.id}>
                <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm">
                  <Link
                    className="gf-console-focus font-semibold text-indigo-700 no-underline hover:underline"
                    href={consoleRoute.document("sites", String(row.id))}
                  >
                    {row.name}
                  </Link>
                  {row.locale !== null && (
                    <span className="pl-2 text-xs text-[var(--console-ink-muted)]">
                      {row.locale}
                    </span>
                  )}
                </td>
                <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                  {row.status === null ? "—" : (STATUS_LABELS[row.status] ?? row.status)}
                </td>
                <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm font-semibold tabular-nums text-[var(--console-ink)]">
                  {row.articleCount}
                </td>
                <td className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink-muted)]">
                  {formatInstant(row.lastPublishedAt)}
                </td>
                {isSuperAdmin && (
                  <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                    {row.tenantName ?? "—"}
                  </td>
                )}
                <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm">
                  <Link
                    className="gf-console-focus text-xs font-semibold text-indigo-700 no-underline hover:underline"
                    href={consoleRoute.document("sites", String(row.id))}
                  >
                    详情 · 文章 · 发布历史
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    <footer className="flex items-center justify-between gap-3 px-5 py-4">
      <span className="text-xs text-[var(--console-ink-muted)]">
        第 {page} / {Math.max(totalPages, 1)} 页
      </span>
      <div className="flex gap-2">
        <Link
          aria-disabled={page <= 1}
          className="gf-console-focus inline-flex h-9 items-center rounded-lg border border-[var(--console-border)] px-3 text-xs font-semibold text-[var(--console-ink)] no-underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
          href={`${consoleRoute.collection("sites")}?page=${Math.max(page - 1, 1)}`}
        >
          上一页
        </Link>
        <Link
          aria-disabled={page >= totalPages}
          className="gf-console-focus inline-flex h-9 items-center rounded-lg border border-[var(--console-border)] px-3 text-xs font-semibold text-[var(--console-ink)] no-underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
          href={`${consoleRoute.collection("sites")}?page=${Math.min(page + 1, Math.max(totalPages, 1))}`}
        >
          下一页
        </Link>
      </div>
    </footer>
  </section>
)

export default SitesWorkspace

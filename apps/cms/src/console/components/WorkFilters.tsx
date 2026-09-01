import Link from "next/link"

import { CalendarClockIcon, FilterIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  defaultCustomDays,
  type WorkQuery,
  type WorkRange,
  workHref,
} from "@/console/lib/work-filters"

const RANGE_ITEMS: readonly Readonly<{ label: string; range: WorkRange }>[] = [
  { label: "今天", range: "today" },
  { label: "近 7 天", range: "7d" },
  { label: "近 30 天", range: "30d" },
  { label: "全部时间", range: "all" },
  { label: "自定义", range: "custom" },
]

export const WorkFilters = ({ query }: { readonly query: WorkQuery }) => {
  const customDays =
    query.range === "custom" && query.from !== null && query.to !== null
      ? { from: query.from, to: query.to }
      : defaultCustomDays()

  return (
    <section className="gf-console-card shrink-0 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600">
            <FilterIcon size={18} />
          </span>
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--console-ink)]">工作范围</p>
            <p className="m-0 pt-0.5 text-xs text-[var(--console-ink-muted)]">
              按最近更新筛选，条件会保留在链接中。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            type="button"
            variant={query.view === "active" ? "default" : "secondary"}
          >
            <Link href={workHref(query, { page: 1, view: "active" })}>活动工作</Link>
          </Button>
          <Button
            asChild
            size="sm"
            type="button"
            variant={query.view === "all" ? "default" : "secondary"}
          >
            <Link href={workHref(query, { page: 1, view: "all" })}>全部记录</Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--console-border)] pt-4">
        <span className="ml-0.5 text-[var(--console-ink-muted)]">
          <CalendarClockIcon size={16} />
        </span>
        {RANGE_ITEMS.map((item) => (
          <Button
            asChild
            key={item.range}
            size="sm"
            type="button"
            variant={query.range === item.range ? "default" : "secondary"}
          >
            <Link
              href={workHref(
                query,
                item.range === "custom"
                  ? { from: customDays.from, page: 1, range: "custom", to: customDays.to }
                  : { from: null, page: 1, range: item.range, to: null },
              )}
            >
              {item.label}
            </Link>
          </Button>
        ))}
      </div>

      {query.range === "custom" && (
        <form
          action="/admin/work"
          className="mt-4 grid gap-3 border-t border-[var(--console-border)] pt-4 sm:grid-cols-[minmax(0,180px)_minmax(0,180px)_auto] sm:items-end"
          method="get"
        >
          <input name="range" type="hidden" value="custom" />
          {query.view !== "active" && <input name="view" type="hidden" value={query.view} />}
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
            起始日期
            <input
              className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
              defaultValue={customDays.from}
              name="from"
              required
              type="date"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
            结束日期
            <input
              className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
              defaultValue={customDays.to}
              name="to"
              required
              type="date"
            />
          </label>
          <Button className="h-10" type="submit">
            应用范围
          </Button>
        </form>
      )}
    </section>
  )
}

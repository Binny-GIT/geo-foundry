"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { AlertTriangleIcon, FilePlusIcon, FilterIcon, LayersIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { BOARD_COLUMNS, type BoardColumnKey } from "@/console/lib/board-model"
import { consoleRoute } from "@/console/lib/resources"
import {
  ALL_WORK_COLUMNS,
  type WorkQuery,
  type WorkRange,
  WORK_RANGES,
  workHref,
  workRangeLabel,
} from "@/console/lib/work-filters"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "gf-work-filters"
const RANGE_OPTIONS: readonly WorkRange[] = WORK_RANGES

type OwnerOption = Readonly<{ readonly email: string; readonly id: number }>
type SiteOption = Readonly<{ readonly id: number; readonly name: string }>

type StoredFilters = {
  columns?: readonly string[]
  filterOpen?: boolean
  owner?: number | null
  q?: string | null
  range?: WorkRange
  site?: number | null
}

const hasQueryParams = (): boolean => window.location.search.length > 0

const selectClass =
  "gf-console-focus h-9 cursor-pointer rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-sm text-[var(--console-ink)] outline-none"

export const WorkToolbar = ({
  canCreate,
  failedCount,
  owners,
  query,
  sites,
}: {
  readonly canCreate: boolean
  readonly failedCount: number
  readonly owners: readonly OwnerOption[]
  readonly query: WorkQuery
  readonly sites: readonly SiteOption[]
}) => {
  const router = useRouter()
  const [filterOpen, setFilterOpen] = useState(true)
  const [search, setSearch] = useState(query.q ?? "")

  /*
   * Filter memory: on first mount with a clean URL, restore the persisted
   * filters by rewriting the URL (deep links always win over memory). Every
   * subsequent query change is mirrored back into localStorage.
   */
  useEffect(() => {
    let stored: StoredFilters = {}
    try {
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredFilters
    } catch {
      stored = {}
    }
    if (stored.filterOpen === false) setFilterOpen(false)
    if (!hasQueryParams() && Object.keys(stored).length > 0) {
      const restored = workHref({
        ...query,
        ...(stored.range !== undefined ? { range: stored.range } : {}),
        ...(stored.q !== null && stored.q !== undefined ? { q: stored.q } : {}),
        owner: stored.owner ?? null,
        site: stored.site ?? null,
        showColumns:
          stored.columns !== undefined && stored.columns.length > 0
            ? stored.columns.filter((key): key is BoardColumnKey =>
                ALL_WORK_COLUMNS.includes(key as BoardColumnKey),
              )
            : ALL_WORK_COLUMNS,
      })
      if (restored !== "/admin/work") router.replace(restored)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore-once on mount
  }, [])

  useEffect(() => {
    setSearch(query.q ?? "")
    const stored: StoredFilters = {
      columns: [...query.showColumns],
      filterOpen,
      owner: query.owner,
      q: query.q,
      range: query.range,
      site: query.site,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }, [filterOpen, query])

  const go = (overrides: Parameters<typeof workHref>[1]) => {
    router.push(workHref(query, { page: 1, ...overrides }))
  }

  const toggleColumn = (key: BoardColumnKey) => {
    const next = query.showColumns.includes(key)
      ? query.showColumns.filter((column) => column !== key)
      : [...query.showColumns, key]
    go({ showColumns: next.length === 0 ? ALL_WORK_COLUMNS : next })
  }

  return (
    <section className="gf-console-card shrink-0 p-3 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600">
          <LayersIcon size={18} />
        </span>
        <h1 className="m-0 text-base font-bold tracking-tight text-[var(--console-ink)]">工作台</h1>
        <select
          aria-label="期间范围"
          className={selectClass}
          onChange={(event) => go({ from: null, range: event.target.value as WorkRange, to: null })}
          value={query.range === "custom" ? "custom" : query.range}
        >
          {RANGE_OPTIONS.map((range) => (
            <option key={range} value={range}>
              {workRangeLabel(range)}
            </option>
          ))}
        </select>
        {failedCount > 0 && (
          <Button asChild type="button" variant="danger">
            <Link href={consoleRoute.collection("operations")}>
              <AlertTriangleIcon size={15} />
              {failedCount} 个失败操作
            </Link>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            aria-label={filterOpen ? "隐藏过滤栏" : "显示过滤栏"}
            aria-pressed={filterOpen}
            className={cn(
              filterOpen &&
                "bg-[var(--console-accent)]/10 text-[var(--gf-btn-primary)] hover:bg-[var(--console-accent)]/15",
            )}
            onClick={() => setFilterOpen((open) => !open)}
            size="icon"
            title={filterOpen ? "隐藏过滤栏" : "显示过滤栏"}
            type="button"
            variant="secondary"
          >
            <FilterIcon size={16} />
          </Button>
          {canCreate && (
            <Button
              asChild
              aria-label="新增文章"
              size="icon"
              title="新增文章"
              type="button"
            >
              <Link href="/admin/workspace/editions/new">
                <FilePlusIcon size={16} />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {filterOpen && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--console-border)] pt-3">
          <form
            className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-xs"
            onSubmit={(event) => {
              event.preventDefault()
              go({ q: search.trim().length === 0 ? null : search.trim() })
            }}
          >
            <input
              aria-label="搜索标题"
              className="gf-console-focus h-9 min-w-0 flex-1 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题…"
              value={search}
            />
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            {BOARD_COLUMNS.map((column) => {
              const checked = query.showColumns.includes(column.key)
              return (
                <button
                  aria-pressed={checked}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                    checked
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink-muted)] hover:bg-[var(--console-surface-muted)]",
                  )}
                  key={column.key}
                  onClick={() => toggleColumn(column.key)}
                  type="button"
                >
                  {column.label}
                </button>
              )
            })}
          </div>
          <select
            aria-label="分配人"
            className={selectClass}
            onChange={(event) =>
              go({ owner: event.target.value === "" ? null : Number(event.target.value) })
            }
            value={query.owner === null ? "" : String(query.owner)}
          >
            <option value="">全部分配人</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.email}
              </option>
            ))}
          </select>
          <select
            aria-label="站点"
            className={selectClass}
            onChange={(event) =>
              go({ site: event.target.value === "" ? null : Number(event.target.value) })
            }
            value={query.site === null ? "" : String(query.site)}
          >
            <option value="">全部站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {query.range === "custom" && (
        <form
          action="/admin/work"
          className="mt-3 grid gap-2 border-t border-[var(--console-border)] pt-3 sm:grid-cols-[minmax(0,170px)_minmax(0,170px)_auto] sm:items-center"
          method="get"
        >
          <input name="range" type="hidden" value="custom" />
          {query.q !== null && <input name="q" type="hidden" value={query.q} />}
          {query.owner !== null && <input name="owner" type="hidden" value={query.owner} />}
          {query.site !== null && <input name="site" type="hidden" value={query.site} />}
          {query.showColumns.length !== ALL_WORK_COLUMNS.length && (
            <input name="columns" type="hidden" value={[...query.showColumns].join(",")} />
          )}
          <input
            aria-label="起始日期"
            className="gf-console-focus h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
            name="from"
            required
            type="date"
          />
          <input
            aria-label="结束日期"
            className="gf-console-focus h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
            name="to"
            required
            type="date"
          />
          <Button size="md" type="submit">
            应用范围
          </Button>
        </form>
      )}
    </section>
  )
}

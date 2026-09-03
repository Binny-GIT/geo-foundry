"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  FilePlusIcon,
  FilterIcon,
  LayersIcon,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeferredText from "@/console/components/DeferredText"
import { BOARD_COLUMNS, type BoardColumnKey } from "@/console/lib/board-model"
import { consoleRoute } from "@/console/lib/resources"
import {
  ALL_WORK_COLUMNS,
  WORK_RANGES,
  type WorkQuery,
  type WorkRange,
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [search, setSearch] = useState(query.q ?? "")

  /*
   * Filter memory: on first mount with a clean URL, restore the persisted
   * filters by rewriting the URL (deep links always win over memory). Every
   * subsequent query change is mirrored back into localStorage. The filter
   * bar stays collapsed unless the visitor explicitly opened it before.
   */
  useEffect(() => {
    let stored: StoredFilters = {}
    try {
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredFilters
    } catch {
      stored = {}
    }
    if (stored.filterOpen === true) setFilterOpen(true)
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
            <Button asChild aria-label="新增文章" size="icon" title="新增文章" type="button">
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
            className="flex h-9 min-w-[220px] flex-1 items-center gap-2 sm:max-w-md"
            onSubmit={(event) => {
              event.preventDefault()
              go({ q: search.trim().length === 0 ? null : search.trim() })
            }}
          >
            <input
              aria-label="搜索标题"
              className="gf-console-focus h-9 min-w-0 flex-1 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按关键词过滤标题…"
              value={search}
            />
          </form>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="gf-console-focus flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-sm text-[var(--console-ink)] outline-none"
                aria-label="筛选状态列"
              >
                <span className="font-medium">
                  状态：
                  {query.showColumns.length === ALL_WORK_COLUMNS.length
                    ? "全部"
                    : `${query.showColumns.length}/${ALL_WORK_COLUMNS.length}`}
                </span>
                <span
                  aria-hidden
                  className="grid place-items-center text-[var(--console-ink-muted)]"
                >
                  <ChevronDownIcon size={14} />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36">
                {BOARD_COLUMNS.map((column) => (
                  <DropdownMenuCheckboxItem
                    checked={query.showColumns.includes(column.key)}
                    key={column.key}
                    onCheckedChange={() => toggleColumn(column.key)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <select
              aria-label="分配人"
              className={`${selectClass} w-44 shrink-0`}
              onChange={(event) =>
                go({ owner: event.target.value === "" ? null : Number(event.target.value) })
              }
              value={query.owner === null ? "" : String(query.owner)}
            >
              <option value="">全部分配人</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  <DeferredText>{owner.email}</DeferredText>
                </option>
              ))}
            </select>
            <select
              aria-label="站点"
              className={`${selectClass} w-36 shrink-0`}
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

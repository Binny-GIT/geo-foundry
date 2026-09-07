"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  FilePlusIcon,
  FilterIcon,
  SearchIcon,
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
  owner?: readonly number[]
  q?: string | null
  range?: WorkRange
  site?: readonly number[]
}

const hasQueryParams = (): boolean => window.location.search.length > 0

const selectClass =
  "gf-console-focus h-9 cursor-pointer rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-sm text-[var(--console-ink)] outline-none"

const leadingIconClass =
  "pointer-events-none absolute left-2.5 top-1/2 grid -translate-y-1/2 place-items-center text-[var(--console-ink-muted)]"

const filterDropdownTriggerClass =
  "gf-console-focus flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-sm text-[var(--console-ink)] outline-none"

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
  const [columns, setColumns] = useState(query.showColumns)
  const [ownerSel, setOwnerSel] = useState(query.owner)
  const [siteSel, setSiteSel] = useState(query.site)
  const columnsRef = useRef(columns)
  const ownerRef = useRef(ownerSel)
  const siteRef = useRef(siteSel)

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
        owner: stored.owner ?? [],
        site: stored.site ?? [],
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
    setColumns(query.showColumns)
    setOwnerSel(query.owner)
    setSiteSel(query.site)
    columnsRef.current = query.showColumns
    ownerRef.current = query.owner
    siteRef.current = query.site
    const stored: StoredFilters = {
      columns: [...query.showColumns],
      filterOpen,
      owner: [...query.owner],
      q: query.q,
      range: query.range,
      site: [...query.site],
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }, [filterOpen, query])

  const go = (overrides: Parameters<typeof workHref>[1]) => {
    router.push(workHref(query, overrides))
  }

  /*
   * Every multi-select toggle below reads and writes a ref alongside its
   * mirrored state. `query` (and the state synced from it) only catches up
   * once the resulting navigation round-trips back from the server, so
   * clicking several checkboxes back to back before that round-trip lands
   * used to compute each toggle from the same stale base — losing all but
   * the last click and freezing the trigger label on a stale count (e.g.
   * "状态：5/6" regardless of how many boxes were actually toggled). The ref
   * is updated synchronously on every click, so the next click always sees
   * the latest selection.
   */
  const toggleColumn = (key: BoardColumnKey) => {
    const current = columnsRef.current
    const next = current.includes(key)
      ? current.filter((column) => column !== key)
      : [...current, key]
    const applied = next.length === 0 ? ALL_WORK_COLUMNS : next
    columnsRef.current = applied
    setColumns(applied)
    go({ showColumns: applied })
  }

  const toggleOwner = (id: number) => {
    const current = ownerRef.current
    const next = current.includes(id) ? current.filter((owner) => owner !== id) : [...current, id]
    ownerRef.current = next
    setOwnerSel(next)
    go({ owner: next })
  }

  const clearOwner = () => {
    ownerRef.current = []
    setOwnerSel([])
    go({ owner: [] })
  }

  const toggleSite = (id: number) => {
    const current = siteRef.current
    const next = current.includes(id) ? current.filter((site) => site !== id) : [...current, id]
    siteRef.current = next
    setSiteSel(next)
    go({ site: next })
  }

  const clearSite = () => {
    siteRef.current = []
    setSiteSel([])
    go({ site: [] })
  }

  return (
    <section className="gf-console-card shrink-0 p-3 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative">
          <span aria-hidden className={leadingIconClass}>
            <CalendarClockIcon size={14} />
          </span>
          <select
            aria-label="期间范围"
            className={cn(selectClass, "pl-8")}
            onChange={(event) =>
              go({ from: null, range: event.target.value as WorkRange, to: null })
            }
            value={query.range === "custom" ? "custom" : query.range}
          >
            {RANGE_OPTIONS.map((range) => (
              <option key={range} value={range}>
                {workRangeLabel(range)}
              </option>
            ))}
          </select>
        </div>
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
            <div className="relative min-w-0 flex-1">
              <span aria-hidden className={leadingIconClass}>
                <SearchIcon size={14} />
              </span>
              <input
                aria-label="搜索标题"
                className="gf-console-focus h-9 w-full rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] py-0 pl-8 pr-3 text-sm text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="按关键词过滤标题…"
                value={search}
              />
            </div>
          </form>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="筛选状态列" className={filterDropdownTriggerClass}>
                <span className="font-medium">
                  状态：
                  {columns.length === ALL_WORK_COLUMNS.length
                    ? "全部"
                    : `${columns.length}/${ALL_WORK_COLUMNS.length}`}
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
                    checked={columns.includes(column.key)}
                    key={column.key}
                    onCheckedChange={() => toggleColumn(column.key)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="筛选分配人" className={filterDropdownTriggerClass}>
                <span className="font-medium">
                  分配人：{ownerSel.length === 0 ? "全部" : `${ownerSel.length}/${owners.length}`}
                </span>
                <span
                  aria-hidden
                  className="grid place-items-center text-[var(--console-ink-muted)]"
                >
                  <ChevronDownIcon size={14} />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 min-w-48 overflow-y-auto">
                <DropdownMenuCheckboxItem
                  checked={ownerSel.length === 0}
                  onCheckedChange={() => clearOwner()}
                  onSelect={(event) => event.preventDefault()}
                >
                  全部分配人
                </DropdownMenuCheckboxItem>
                {owners.map((owner) => (
                  <DropdownMenuCheckboxItem
                    checked={ownerSel.includes(owner.id)}
                    key={owner.id}
                    onCheckedChange={() => toggleOwner(owner.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <DeferredText>{owner.email}</DeferredText>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="筛选站点" className={filterDropdownTriggerClass}>
                <span className="font-medium">
                  站点：{siteSel.length === 0 ? "全部" : `${siteSel.length}/${sites.length}`}
                </span>
                <span
                  aria-hidden
                  className="grid place-items-center text-[var(--console-ink-muted)]"
                >
                  <ChevronDownIcon size={14} />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 min-w-40 overflow-y-auto">
                <DropdownMenuCheckboxItem
                  checked={siteSel.length === 0}
                  onCheckedChange={() => clearSite()}
                  onSelect={(event) => event.preventDefault()}
                >
                  全部站点
                </DropdownMenuCheckboxItem>
                {sites.map((site) => (
                  <DropdownMenuCheckboxItem
                    checked={siteSel.includes(site.id)}
                    key={site.id}
                    onCheckedChange={() => toggleSite(site.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {site.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
          {query.owner.length > 0 && (
            <input name="owner" type="hidden" value={[...query.owner].join(",")} />
          )}
          {query.site.length > 0 && (
            <input name="site" type="hidden" value={[...query.site].join(",")} />
          )}
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

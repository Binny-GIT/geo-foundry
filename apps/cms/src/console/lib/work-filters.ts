import type { Where } from "payload"

import { BOARD_COLUMNS, type BoardColumnKey } from "./board-model"
import { combineWhere } from "./site-scope"

export const WORK_RANGES = ["today", "7d", "30d", "90d", "180d", "custom", "all"] as const
export type WorkRange = (typeof WORK_RANGES)[number]

export const ALL_WORK_COLUMNS: readonly BoardColumnKey[] = BOARD_COLUMNS.map((column) => column.key)

export type WorkQuery = Readonly<{
  from: string | null
  owner: number | null
  page: number
  q: string | null
  range: WorkRange
  showColumns: readonly BoardColumnKey[]
  site: number | null
  to: string | null
}>

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

const positiveInt = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const isoDay = (value: string | null): string | null => {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null
}

const parseColumns = (value: string | null): readonly BoardColumnKey[] => {
  if (value === null) return ALL_WORK_COLUMNS
  const keys = value
    .split(",")
    .map((key) => key.trim())
    .filter((key): key is BoardColumnKey => ALL_WORK_COLUMNS.includes(key as BoardColumnKey))
  return keys.length === 0 ? ALL_WORK_COLUMNS : [...new Set(keys)]
}

const utcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))

const shiftDays = (value: Date, days: number): Date => {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const dayText = (value: Date): string => value.toISOString().slice(0, 10)

export const parseWorkQuery = (
  searchParams: Record<string, string | string[] | undefined>,
): WorkQuery => {
  const rawRange = first(searchParams["range"])
  const from = isoDay(first(searchParams["from"]))
  const to = isoDay(first(searchParams["to"]))
  const customIsValid = from !== null && to !== null && from <= to
  const qRaw = first(searchParams["q"])?.trim() ?? ""

  return {
    from: customIsValid ? from : null,
    owner: positiveInt(first(searchParams["owner"])),
    page: positiveInt(first(searchParams["page"])) ?? 1,
    q: qRaw.length === 0 ? null : qRaw.slice(0, 100),
    range:
      rawRange === "custom" && !customIsValid
        ? "30d"
        : WORK_RANGES.includes(rawRange as WorkRange)
          ? (rawRange as WorkRange)
          : "30d",
    showColumns: parseColumns(first(searchParams["columns"])),
    site: positiveInt(first(searchParams["site"])),
    to: customIsValid ? to : null,
  }
}

const dateWhere = (query: WorkQuery, now: Date): Where | undefined => {
  if (query.range === "all") return undefined

  const today = utcDay(now)
  if (query.range === "custom" && query.from != null && query.to != null) {
    return {
      updatedAt: {
        greater_than_equal: `${query.from}T00:00:00.000Z`,
        less_than: shiftDays(new Date(`${query.to}T00:00:00.000Z`), 1).toISOString(),
      },
    }
  }

  const start = (() => {
    switch (query.range) {
      case "today":
        return today
      case "7d":
        return shiftDays(today, -6)
      case "90d":
        return shiftDays(today, -89)
      case "180d":
        return shiftDays(today, -179)
      default:
        return shiftDays(today, -29)
    }
  })()

  return {
    updatedAt: {
      greater_than_equal: start.toISOString(),
      less_than: shiftDays(today, 1).toISOString(),
    },
  }
}

export const workWhere = (query: WorkQuery, now = new Date()): Where | undefined => {
  const conditions: Where[] = []
  if (query.q !== null) conditions.push({ title: { like: query.q } })
  if (query.owner !== null) conditions.push({ owner: { equals: query.owner } })
  if (query.site !== null) conditions.push({ site: { equals: query.site } })
  const dates = dateWhere(query, now)
  if (dates !== undefined) conditions.push(dates)
  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0]! : { and: conditions }
}

export const scopedWorkWhere = (
  query: WorkQuery,
  scopeWhere: Where | undefined,
  now = new Date(),
): Where | undefined => combineWhere(scopeWhere, workWhere(query, now))

export const workHref = (query: WorkQuery, overrides: Partial<WorkQuery> = {}): string => {
  const merged: WorkQuery = { ...query, ...overrides }
  const params = new URLSearchParams()

  if (merged.range !== "30d") params.set("range", merged.range)
  if (merged.range === "custom" && merged.from !== null && merged.to !== null) {
    params.set("from", merged.from)
    params.set("to", merged.to)
  }
  if (merged.q !== null) params.set("q", merged.q)
  if (merged.owner !== null) params.set("owner", String(merged.owner))
  if (merged.site !== null) params.set("site", String(merged.site))
  const { showColumns } = merged
  if (showColumns.length !== ALL_WORK_COLUMNS.length) {
    params.set("columns", [...showColumns].join(","))
  }
  if (merged.page > 1) params.set("page", String(merged.page))

  const search = params.toString()
  return search.length === 0 ? "/admin/work" : `/admin/work?${search}`
}

export const workRangeLabel = (range: WorkRange): string => {
  switch (range) {
    case "today":
      return "今天"
    case "7d":
      return "近 7 天"
    case "30d":
      return "近 30 天"
    case "90d":
      return "近 3 个月"
    case "180d":
      return "近半年"
    case "custom":
      return "自定义"
    case "all":
      return "全部时间"
  }
}

export const defaultCustomDays = (now = new Date()): Readonly<{ from: string; to: string }> => {
  const today = utcDay(now)
  return { from: dayText(shiftDays(today, -29)), to: dayText(today) }
}

import type { Where } from "payload"

import { combineWhere } from "./site-scope"

export const WORK_RANGES = ["today", "7d", "30d", "custom", "all"] as const
export const WORK_VIEWS = ["active", "all"] as const

export type WorkRange = (typeof WORK_RANGES)[number]
export type WorkView = (typeof WORK_VIEWS)[number]

export type WorkQuery = Readonly<{
  from: string | null
  page: number
  range: WorkRange
  to: string | null
  view: WorkView
}>

const ACTIVE_WORKFLOW_STATUSES = ["draft", "generating", "review", "approved", "compiled"] as const
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
  const rawView = first(searchParams["view"])
  const from = isoDay(first(searchParams["from"]))
  const to = isoDay(first(searchParams["to"]))
  const customIsValid = from !== null && to !== null && from <= to

  return {
    from: customIsValid ? from : null,
    page: positiveInt(first(searchParams["page"])) ?? 1,
    range:
      rawRange === "custom" && !customIsValid
        ? "30d"
        : WORK_RANGES.includes(rawRange as WorkRange)
          ? (rawRange as WorkRange)
          : "30d",
    to: customIsValid ? to : null,
    view: WORK_VIEWS.includes(rawView as WorkView) ? (rawView as WorkView) : "active",
  }
}

const dateWhere = (query: WorkQuery, now: Date): Where | undefined => {
  if (query.range === "all") return undefined

  const today = utcDay(now)
  if (query.range === "custom" && query.from !== null && query.to !== null) {
    return {
      updatedAt: {
        greater_than_equal: `${query.from}T00:00:00.000Z`,
        less_than: shiftDays(new Date(`${query.to}T00:00:00.000Z`), 1).toISOString(),
      },
    }
  }

  const start =
    query.range === "today"
      ? today
      : query.range === "7d"
        ? shiftDays(today, -6)
        : shiftDays(today, -29)

  return {
    updatedAt: {
      greater_than_equal: start.toISOString(),
      less_than: shiftDays(today, 1).toISOString(),
    },
  }
}

export const workWhere = (query: WorkQuery, now = new Date()): Where | undefined => {
  const activeWhere: Where | undefined =
    query.view === "active" ? { workflowStatus: { in: [...ACTIVE_WORKFLOW_STATUSES] } } : undefined
  return combineWhere(activeWhere, dateWhere(query, now))
}

export const scopedWorkWhere = (
  query: WorkQuery,
  scopeWhere: Where | undefined,
  now = new Date(),
): Where | undefined => combineWhere(scopeWhere, workWhere(query, now))

export const workHref = (query: WorkQuery, overrides: Partial<WorkQuery> = {}): string => {
  const merged: WorkQuery = { ...query, ...overrides }
  const params = new URLSearchParams()

  if (merged.view !== "active") params.set("view", merged.view)
  if (merged.range !== "30d") params.set("range", merged.range)
  if (merged.range === "custom" && merged.from !== null && merged.to !== null) {
    params.set("from", merged.from)
    params.set("to", merged.to)
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

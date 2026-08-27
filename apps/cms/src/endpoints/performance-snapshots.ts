import type { Endpoint } from "payload"
import { z } from "zod"

import { acceptPerformanceSuggestion, importPerformanceSnapshots, performanceSuggestions, PerformanceSnapshotsError } from "../services/performance-snapshots"

const importRowSchema = z.object({
  conversions: z.number().min(0).optional(),
  editionId: z.number().int().positive().optional(),
  engagement: z.number().min(0).optional(),
  observedAt: z.string(),
  source: z.string().min(1).max(200),
  url: z.string().url().max(4000),
  visits: z.number().min(0).optional(),
}).strict()
const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(1000),
  siteId: z.number().int().positive(),
}).strict()
const acceptSchema = z.object({ editionId: z.number().int().positive() }).strict()
const CSV_HEADERS = ["siteId", "editionId", "observedAt", "source", "url", "visits", "engagement", "conversions"] as const
const CSV_REQUIRED_HEADERS = ["siteId", "observedAt", "source", "url"] as const
const MAX_CSV_BYTES = 2_000_000
const MAX_CSV_ROWS = 1000

type CsvRequest = Readonly<{
  headers?: Headers
  text?: () => Promise<string>
}>

const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" }, status })

const csvRowsOf = (text: string): readonly string[][] | null => {
  const rows: string[][] = []
  let cell = ""
  let row: string[] = []
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? ""
    if (quoted) {
      if (character !== '"') {
        cell += character
        continue
      }
      if (text[index + 1] === '"') {
        cell += '"'
        index += 1
        continue
      }
      quoted = false
      continue
    }
    if (character === '"') {
      if (cell.length > 0) return null
      quoted = true
    } else if (character === ",") {
      row.push(cell)
      cell = ""
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      row.push(cell)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ""
    } else {
      cell += character
    }
  }
  if (quoted) return null
  row.push(cell)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

const numberOf = (value: string, integer = false): number | undefined | null => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric) || numeric < 0 || (integer && !Number.isInteger(numeric))) return null
  return numeric
}

const csvImportOf = (text: string): unknown | null => {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) return null
  const records = csvRowsOf(text)
  if (records === null || records.length < 2 || records.length - 1 > MAX_CSV_ROWS) return null
  const headers = records[0]?.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim()))
  if (headers === undefined || new Set(headers).size !== headers.length || headers.some((header) => !CSV_HEADERS.includes(header as (typeof CSV_HEADERS)[number])) || CSV_REQUIRED_HEADERS.some((header) => !headers.includes(header))) return null
  const values = records.slice(1)
  if (values.some((row) => row.length !== headers.length)) return null
  let siteId: number | undefined
  const rows = [] as z.infer<typeof importRowSchema>[]
  for (const record of values) {
    const row = Object.fromEntries(headers.map((header, index) => [header, (record[index] ?? "").trim()]))
    const recordSiteId = numberOf(row["siteId"] ?? "", true)
    const editionId = numberOf(row["editionId"] ?? "", true)
    const visits = numberOf(row["visits"] ?? "")
    const engagement = numberOf(row["engagement"] ?? "")
    const conversions = numberOf(row["conversions"] ?? "")
    if (recordSiteId === null || recordSiteId === undefined || recordSiteId <= 0 || editionId === null || engagement === null || visits === null || conversions === null) return null
    if (siteId !== undefined && siteId !== recordSiteId) return null
    siteId = recordSiteId
    const parsed = importRowSchema.safeParse({
      observedAt: row["observedAt"],
      source: row["source"],
      url: row["url"],
      ...(conversions === undefined ? {} : { conversions }),
      ...(editionId === undefined ? {} : { editionId }),
      ...(engagement === undefined ? {} : { engagement }),
      ...(visits === undefined ? {} : { visits }),
    })
    if (!parsed.success) return null
    rows.push(parsed.data)
  }
  return siteId === undefined ? null : { rows, siteId }
}

const importBodyOf = async (req: CsvRequest & { json?: () => Promise<unknown> }): Promise<unknown | null> => {
  const contentType = req.headers?.get("content-type")?.toLowerCase() ?? ""
  if (contentType.startsWith("text/csv")) {
    const text = await req.text?.().catch(() => null)
    return typeof text === "string" ? csvImportOf(text) : null
  }
  return await req.json?.().catch(() => null)
}
const errorOf = (error: unknown): Response => {
  if (!(error instanceof PerformanceSnapshotsError)) throw error
  const status = error.code.includes("UNAUTHENTICATED") ? 401 : error.code.includes("REQUIRED") ? 403 : error.code.includes("NOT_FOUND") ? 404 : 400
  return response(status, { error: { code: error.code } })
}

export const importPerformanceSnapshotsEndpoint: Endpoint = {
  handler: async (req) => {
    const parsed = importSchema.safeParse(await importBodyOf(req))
    if (!parsed.success) return response(400, { error: { code: "PERFORMANCE_SNAPSHOT_BODY_INVALID" } })
    try {
      return response(
        201,
        await importPerformanceSnapshots(req.payload, {
          rows: parsed.data.rows.map((row) => ({
            observedAt: row.observedAt,
            source: row.source,
            url: row.url,
            ...(row.conversions === undefined ? {} : { conversions: row.conversions }),
            ...(row.editionId === undefined ? {} : { editionId: row.editionId }),
            ...(row.engagement === undefined ? {} : { engagement: row.engagement }),
            ...(row.visits === undefined ? {} : { visits: row.visits }),
          })),
          siteId: parsed.data.siteId,
          user: req.user,
        }),
      )
    } catch (error) { return errorOf(error) }
  },
  method: "post",
  path: "/performance-snapshots/import",
}

export const performanceSuggestionsEndpoint: Endpoint = {
  handler: async (req) => {
    try { return response(200, { suggestions: await performanceSuggestions(req.payload, req.user) }) } catch (error) { return errorOf(error) }
  },
  method: "get",
  path: "/performance-snapshots/suggestions",
}

export const acceptPerformanceSuggestionEndpoint: Endpoint = {
  handler: async (req) => {
    const parsed = acceptSchema.safeParse(await req.json?.().catch(() => null))
    if (!parsed.success) return response(400, { error: { code: "PERFORMANCE_SUGGESTION_BODY_INVALID" } })
    try { return response(201, await acceptPerformanceSuggestion(req.payload, { ...parsed.data, user: req.user })) } catch (error) { return errorOf(error) }
  },
  method: "post",
  path: "/performance-snapshots/suggestions/accept",
}

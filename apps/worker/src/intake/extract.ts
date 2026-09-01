import { XMLParser } from "fast-xml-parser"

export { extractStructuredArticle } from "@geo/content-pipeline"
export type { ExtractedBlock, ExtractedPage } from "@geo/content-pipeline"

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim()

type XmlRecord = Record<string, unknown>

const recordOf = (value: unknown): XmlRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlRecord) : null

const arrayOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") return normalizeText(value) || undefined
  if (typeof value === "number") return String(value)
  const record = recordOf(value)
  if (record !== null && typeof record["#text"] === "string") return normalizeText(record["#text"]) || undefined
  return undefined
}

const linkOf = (value: unknown): string | undefined => {
  const direct = text(value)
  if (direct !== undefined && /^https?:\/\//i.test(direct)) return direct
  for (const item of arrayOf(value)) {
    const record = recordOf(item)
    const href = record === null ? undefined : text(record["@_href"])
    if (href !== undefined && /^https?:\/\//i.test(href)) return href
  }
  return undefined
}

export type RssEntry = Readonly<{
  sourceUrl: string
  summary?: string
  title: string
}>

/** Parses bounded RSS 2.0 or Atom XML into normal URL intake entries. */
export const extractRssEntries = (xml: string): readonly RssEntry[] => {
  let parsed: unknown
  try {
    parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml)
  } catch {
    throw new Error("INTAKE_RSS_INVALID")
  }
  const root = recordOf(parsed)
  if (root === null) throw new Error("INTAKE_RSS_INVALID")
  const rss = recordOf(root["rss"])
  const feed = recordOf(root["feed"])
  const rawEntries = rss === null
    ? feed === null
      ? []
      : arrayOf(feed["entry"])
    : arrayOf(recordOf(rss["channel"] )?.["item"])
  const entries: RssEntry[] = []
  for (const raw of rawEntries) {
    const entry = recordOf(raw)
    if (entry === null) continue
    const sourceUrl = linkOf(entry["link"])
    const title = text(entry["title"])
    if (sourceUrl === undefined || title === undefined) continue
    const summary = text(entry["description"]) ?? text(entry["summary"]) ?? text(entry["content"])
    entries.push({
      sourceUrl,
      ...(summary === undefined ? {} : { summary }),
      title,
    })
  }
  if (entries.length === 0) throw new Error("INTAKE_RSS_EMPTY")
  return entries.slice(0, 20)
}

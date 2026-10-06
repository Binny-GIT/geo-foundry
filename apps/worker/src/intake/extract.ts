import { XMLParser } from "fast-xml-parser"

export type { ExtractedBlock, ExtractedPage } from "@geo/content-pipeline"
export { extractStructuredArticle } from "@geo/content-pipeline"

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim()

type XmlRecord = Record<string, unknown>

const recordOf = (value: unknown): XmlRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlRecord) : null

const arrayOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") return normalizeText(value) || undefined
  if (typeof value === "number") return String(value)
  const record = recordOf(value)
  if (record !== null && typeof record["#text"] === "string")
    return normalizeText(record["#text"]) || undefined
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

/** Parses bounded RSS 2.0, RSS 1.0 (RDF) or Atom XML into normal URL intake entries. */
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
  // RSS 1.0（Nature、Lancet 等期刊在用）：item 是 rdf:RDF 的直接子元素，不在 channel 里。
  const rdf = recordOf(root["rdf:RDF"])
  const rawEntries =
    rss !== null
      ? arrayOf(recordOf(rss["channel"])?.["item"])
      : feed !== null
        ? arrayOf(feed["entry"])
        : rdf !== null
          ? arrayOf(rdf["item"])
          : []
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

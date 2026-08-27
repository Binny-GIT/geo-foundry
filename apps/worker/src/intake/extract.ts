import { XMLParser } from "fast-xml-parser"
import { parse } from "parse5"

type HtmlNode = Readonly<{
  attrs?: readonly { readonly name?: unknown; readonly value?: unknown }[]
  childNodes?: readonly HtmlNode[]
  nodeName?: unknown
  tagName?: unknown
  value?: unknown
}>

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim()

const textOf = (node: HtmlNode): string => {
  if (typeof node.value === "string") return node.value
  return (node.childNodes ?? []).map(textOf).join(" ")
}

const tagOf = (node: HtmlNode): string =>
  typeof node.tagName === "string" ? node.tagName : typeof node.nodeName === "string" ? node.nodeName : ""

const findFirst = (node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode | null => {
  if (predicate(node)) return node
  for (const child of node.childNodes ?? []) {
    const found = findFirst(child, predicate)
    if (found !== null) return found
  }
  return null
}

const visibleText = (node: HtmlNode): string => {
  const tag = tagOf(node)
  if (["script", "style", "noscript", "template", "svg"].includes(tag)) return ""
  if (typeof node.value === "string") return node.value
  return (node.childNodes ?? []).map(visibleText).join(" ")
}

export type ExtractedArticle = Readonly<{
  summary: string
  text: string
  title: string
}>

/** Deterministic HTML-to-text extraction; scripts and styling never enter content. */
export const extractArticle = (html: string): ExtractedArticle => {
  const document = parse(html) as unknown as HtmlNode
  const titleNode = findFirst(document, (node) => tagOf(node) === "title")
  const main = findFirst(document, (node) => tagOf(node) === "article") ??
    findFirst(document, (node) => tagOf(node) === "main") ??
    findFirst(document, (node) => tagOf(node) === "body")
  const text = normalizeText(main === null ? "" : visibleText(main))
  if (text.length === 0) throw new Error("INTAKE_EXTRACTION_EMPTY")
  return {
    summary: text.slice(0, 500),
    text,
    title: normalizeText(titleNode === null ? "" : textOf(titleNode)) || text.slice(0, 160),
  }
}

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

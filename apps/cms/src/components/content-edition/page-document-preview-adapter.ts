import { PageDocumentSchema, type ContentBlock, type PageDocument } from "@geo/schema"

export type PreviewSource = Readonly<{
  body: unknown
  citations?: unknown
  contentId?: unknown
  editionId?: unknown
  entities?: unknown
  locale?: unknown
  modifiedAt?: unknown
  siteId?: unknown
  summary?: unknown
  title?: unknown
}>

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null

const textItemsOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value.map((item) => (isRow(item) ? item["text"] : item)) : []

const fieldsOf = (value: unknown, keys: readonly string[]): Row | null => {
  if (!isRow(value)) return null
  const result: Row = {}
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) result[key] = value[key]
  }
  return result
}

/**
 * Payload stores blocks with `blockType` plus database-only row identifiers.
 * Preview uses the same normalization contract as validation, but never writes
 * back or makes publication claims about an unsaved draft.
 */
export const previewBlockOf = (value: unknown): unknown => {
  if (!isRow(value)) return value
  const blockType = value["blockType"]
  if (typeof blockType !== "string") return value
  const row: Row = { ...value, type: blockType }
  delete row["blockType"]
  delete row["blockName"]
  delete row["id"]
  if (row["extensions"] === null) delete row["extensions"]

  if (blockType === "heading") {
    row["level"] =
      typeof row["level"] === "string" ? Number.parseInt(row["level"], 10) : row["level"]
  }
  if (blockType === "list") row["items"] = textItemsOf(row["items"])
  if (blockType === "table") {
    row["columns"] = textItemsOf(row["columns"])
    row["rows"] = Array.isArray(row["rows"])
      ? row["rows"].map((item) => (isRow(item) ? textItemsOf(item["cells"]) : item))
      : row["rows"]
  }
  if (blockType === "faq") {
    row["items"] = Array.isArray(row["items"])
      ? row["items"].map((item) => fieldsOf(item, ["question", "answer"]) ?? item)
      : row["items"]
  }
  if (blockType === "references") {
    row["items"] = Array.isArray(row["items"])
      ? row["items"].map((item) => fieldsOf(item, ["citationId", "label"]) ?? item)
      : row["items"]
  }
  return row
}

const stringOf = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback

const integerOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback

const localeOf = (value: unknown): string =>
  typeof value === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value) ? value : "zh-CN"

const instantOf = (value: unknown): string | undefined => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

export type PreviewDocumentResult =
  | Readonly<{ document: PageDocument; ok: true }>
  | Readonly<{ issues: readonly string[]; ok: false }>

export const previewDocumentOf = (source: PreviewSource): PreviewDocumentResult => {
  const title = stringOf(source.title, "Untitled edition")
  const summary = stringOf(source.summary, "Preview draft")
  const editionId = integerOf(source.editionId, 1)
  const contentId = integerOf(source.contentId, editionId)
  const siteId = integerOf(source.siteId, 1)
  const body = Array.isArray(source.body) ? source.body.map(previewBlockOf) : source.body
  const modifiedAt = instantOf(source.modifiedAt)
  const parsed = PageDocumentSchema.safeParse({
    body,
    breadcrumbs: [{ pathname: "/", title: "Preview" }],
    ...(Array.isArray(source.citations) ? { citations: source.citations } : {}),
    ...(Array.isArray(source.entities) ? { entities: source.entities } : {}),
    identity: {
      contentId: `content-${contentId}`,
      editionId: `edition-${editionId}`,
      pageId: `preview-edition-${editionId}`,
      siteId: `site-${siteId}`,
    },
    metadata: {
      description: summary,
      ...(modifiedAt === undefined ? {} : { modifiedAt }),
      title,
    },
    pageType: "article",
    route: {
      canonicalUrl: `https://preview.invalid/editions/${editionId}`,
      locale: localeOf(source.locale),
      pathname: `/preview/editions/${editionId}`,
    },
    schemaVersion: 1,
    seo: {
      description: summary,
      robots: { follow: false, index: false },
      title,
    },
  })
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.slice(0, 3).map((issue) => issue.path.join(".") || issue.message),
      ok: false,
    }
  }
  return { document: parsed.data, ok: true }
}

export const previewBlocksOf = (value: unknown): readonly ContentBlock[] | null => {
  if (!Array.isArray(value)) return null
  const result = previewDocumentOf({ body: value })
  return result.ok && result.document.pageType !== "redirect" ? result.document.body : null
}

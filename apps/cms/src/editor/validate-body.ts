import { ContentBlockSchema } from "@geo/schema"

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null

const textsOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value.map((item) => (isRow(item) ? item["text"] : item)) : []

const fieldsOf = (value: unknown, keys: readonly string[]): Row | null => {
  if (!isRow(value)) {
    return null
  }
  const picked: Row = {}
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) {
      picked[key] = value[key]
    }
  }
  return picked
}

const FAQ_ITEM_KEYS = ["question", "answer"] as const
const REFERENCE_ITEM_KEYS = ["citationId", "label"] as const

/**
 * Convert one stored block row into the PageDocument block shape.
 * Payload stores blocks flattened as `{ blockType, blockName, id, ...fields }`
 * and attaches storage ids to nested item rows; the shared schema expects
 * `{ type, ...fields }` with numeric heading levels, plain-string arrays and
 * strictly-shaped items. Storage ids are dropped for validation only - the
 * stored document keeps them.
 */
const convertBlock = (row: unknown): unknown => {
  if (!isRow(row)) {
    return row
  }
  const slug = row["blockType"]
  if (typeof slug !== "string") {
    return row
  }
  const converted: Row = { ...row, type: slug }
  delete converted["blockType"]
  delete converted["blockName"]
  delete converted["id"]
  if (converted["extensions"] === null) {
    delete converted["extensions"]
  }

  if (slug === "heading") {
    const level = converted["level"]
    converted["level"] = typeof level === "string" ? Number.parseInt(level, 10) : level
  }
  if (slug === "list") {
    converted["items"] = textsOf(converted["items"])
  }
  if (slug === "table") {
    const rows = converted["rows"]
    converted["columns"] = textsOf(converted["columns"])
    converted["rows"] = Array.isArray(rows)
      ? rows.map((rowItem) => (isRow(rowItem) ? textsOf(rowItem["cells"]) : rowItem))
      : rows
  }
  if (slug === "faq") {
    converted["items"] = Array.isArray(converted["items"])
      ? converted["items"].map((item) => fieldsOf(item, FAQ_ITEM_KEYS) ?? item)
      : converted["items"]
  }
  if (slug === "references") {
    converted["items"] = Array.isArray(converted["items"])
      ? converted["items"].map((item) => fieldsOf(item, REFERENCE_ITEM_KEYS) ?? item)
      : converted["items"]
  }
  return converted
}

/**
 * Bridge between the CMS block storage format and the shared PageDocument
 * contract: every write is re-validated against @geo/schema, so a body that
 * cannot compile to a PageDocument never enters the CMS.
 */
export function validateEditionBody(value: unknown): true | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "Body must be a non-empty list of content blocks"
  }
  const parsed = ContentBlockSchema.array().safeParse(value.map(convertBlock))
  return parsed.success ? true : "Body blocks do not satisfy the PageDocument contract"
}

import { parse } from "parse5"

/**
 * Structured HTML article extraction shared by the Worker fetch pipeline and
 * CMS-side refresh tooling. Produces editor-compatible page-document blocks
 * (headings, paragraphs, lists, quotes, code, images) instead of a flattened
 * text blob, plus a metadata-aware summary.
 */

type HtmlNode = Readonly<{
  attrs?: readonly { readonly name?: unknown; readonly value?: unknown }[]
  childNodes?: readonly HtmlNode[]
  nodeName?: unknown
  tagName?: unknown
  value?: unknown
}>

export type ExtractedBlock =
  | { readonly blockType: "heading"; readonly level: "2" | "3" | "4" | "5" | "6"; readonly text: string }
  | { readonly blockType: "paragraph"; readonly text: string }
  | { readonly blockType: "list"; readonly style: "ordered" | "unordered"; readonly items: readonly { readonly text: string }[] }
  | { readonly blockType: "quote"; readonly text: string }
  | { readonly blockType: "code"; readonly code: string; readonly language: string }
  | { readonly blockType: "image"; readonly src: string; readonly alt: string }

export type ExtractedPage = Readonly<{
  blocks: readonly ExtractedBlock[]
  summary: string
  text: string
  title: string
}>

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "nav",
  "aside",
  "footer",
  "form",
  "iframe",
  "button",
  "select",
  "textarea",
  "table",
])

const IMAGE_JUNK = /(sprite|icon|logo|avatar|badge|pixel|1x1|tracker|spacer|blank)\./i

const MAX_BLOCKS = 200
const MAX_TEXT = 4_000
const MAX_TOTAL = 120_000

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim()

const tagOf = (node: HtmlNode): string =>
  typeof node.tagName === "string"
    ? node.tagName
    : typeof node.nodeName === "string"
      ? node.nodeName
      : ""

const attrOf = (node: HtmlNode | null, name: string): string | null => {
  if (node === null) return null
  for (const attr of node.attrs ?? []) {
    if (attr.name === name && typeof attr.value === "string") return attr.value
  }
  return null
}

const visibleText = (node: HtmlNode | null): string => {
  if (node === null) return ""
  const tag = tagOf(node)
  if (SKIP_TAGS.has(tag)) return ""
  if (typeof node.value === "string") return node.value
  return (node.childNodes ?? []).map(visibleText).join("")
}

const rawText = (node: HtmlNode): string => {
  if (typeof node.value === "string") return node.value
  return (node.childNodes ?? []).map(rawText).join("")
}

const findFirst = (node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode | null => {
  if (predicate(node)) return node
  for (const child of node.childNodes ?? []) {
    const found = findFirst(child, predicate)
    if (found !== null) return found
  }
  return null
}

const absoluteUrl = (src: string, base: string): string | null => {
  const trimmed = src.trim()
  if (trimmed.length === 0 || trimmed.startsWith("data:")) return null
  try {
    const url = new URL(trimmed, base)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.href
  } catch {
    return null
  }
}

type WalkState = {
  base: string
  blocks: ExtractedBlock[]
  totalChars: number
}

const pushBlock = (state: WalkState, block: ExtractedBlock): void => {
  if (state.blocks.length >= MAX_BLOCKS) return
  state.blocks.push(block)
  const size =
    block.blockType === "list"
      ? block.items.reduce((sum, item) => sum + item.text.length, 0)
      : block.blockType === "code"
        ? block.code.length
        : block.blockType === "image"
          ? block.src.length
          : block.text.length
  state.totalChars += size
}

const walk = (node: HtmlNode, state: WalkState): void => {
  if (state.blocks.length >= MAX_BLOCKS || state.totalChars >= MAX_TOTAL) return
  const tag = tagOf(node)
  if (SKIP_TAGS.has(tag)) return

  if (tag === "figure") {
    for (const child of node.childNodes ?? []) walk(child, state)
    const caption = findFirst(node, (candidate) => tagOf(candidate) === "figcaption")
    const captionText = caption === null ? "" : normalizeText(visibleText(caption)).slice(0, 300)
    if (captionText.length >= 2) pushBlock(state, { blockType: "paragraph", text: captionText })
    return
  }

  if (tag === "img") {
    const src = absoluteUrl(attrOf(node, "src") ?? attrOf(node, "data-src") ?? "", state.base)
    if (src === null || IMAGE_JUNK.test(src)) return
    const alt = normalizeText(attrOf(node, "alt") ?? "").slice(0, 300)
    pushBlock(state, { alt, blockType: "image", src })
    return
  }

  if (/^h[1-6]$/.test(tag)) {
    const text = normalizeText(visibleText(node)).slice(0, MAX_TEXT)
    if (text.length >= 2) {
      const levelNumber = Number.parseInt(tag.slice(1), 10)
      const level = String(Math.min(Math.max(levelNumber === 1 ? 2 : levelNumber, 2), 6)) as
        | "2"
        | "3"
        | "4"
        | "5"
        | "6"
      pushBlock(state, { blockType: "heading", level, text })
    }
    return
  }

  if (tag === "p" || tag === "figcaption") {
    const image = findFirst(node, (candidate) => tagOf(candidate) === "img")
    const text = normalizeText(visibleText(node)).slice(0, MAX_TEXT)
    if (text.length >= 2) pushBlock(state, { blockType: "paragraph", text })
    if (image !== null) walk(image, state)
    return
  }

  if (tag === "ul" || tag === "ol") {
    const items = (node.childNodes ?? [])
      .filter((child) => tagOf(child) === "li")
      .map((li) => normalizeText(visibleText(li)).slice(0, MAX_TEXT))
      .filter((text) => text.length >= 2)
      .slice(0, 50)
      .map((text) => ({ text }))
    if (items.length > 0) {
      pushBlock(state, { blockType: "list", items, style: tag === "ol" ? "ordered" : "unordered" })
    }
    return
  }

  if (tag === "blockquote") {
    const text = normalizeText(visibleText(node)).slice(0, MAX_TEXT)
    if (text.length >= 2) pushBlock(state, { blockType: "quote", text })
    return
  }

  if (tag === "pre") {
    const code = rawText(node).replace(/\r\n/g, "\n").trim().slice(0, 8_000)
    if (code.length >= 4) pushBlock(state, { blockType: "code", code, language: "text" })
    return
  }

  for (const child of node.childNodes ?? []) walk(child, state)
}

const metaContent = (document: HtmlNode, names: readonly string[]): string => {
  for (const name of names) {
    const meta = findFirst(
      document,
      (node) =>
        tagOf(node) === "meta" &&
        (attrOf(node, "name") === name || attrOf(node, "property") === name),
    )
    const content = meta === null ? null : attrOf(meta, "content")
    if (content !== null && content.trim().length > 0) return content
  }
  return ""
}

/** Extracts a structured article from public HTML. Throws INTAKE_EXTRACTION_EMPTY when nothing usable. */
export const extractStructuredArticle = (html: string, baseUrl: string): ExtractedPage => {
  const document = parse(html) as unknown as HtmlNode
  const titleNode = findFirst(document, (node) => tagOf(node) === "title")
  const main =
    findFirst(document, (node) => tagOf(node) === "article") ??
    findFirst(document, (node) => tagOf(node) === "main") ??
    findFirst(document, (node) => tagOf(node) === "body")

  const state: WalkState = { base: baseUrl, blocks: [], totalChars: 0 }
  if (main !== null) walk(main, state)

  const flatText = normalizeText(main === null ? "" : visibleText(main))
  if (state.blocks.length === 0 && flatText.length === 0) {
    throw new Error("INTAKE_EXTRACTION_EMPTY")
  }

  const title =
    normalizeText(titleNode === null ? "" : visibleText(titleNode)).slice(0, 1_000) ||
    flatText.slice(0, 160)

  const metaSummary = normalizeText(
    metaContent(document, ["description", "og:description", "twitter:description"]),
  ).slice(0, 500)
  const firstParagraph = state.blocks.find(
    (block) => block.blockType === "paragraph" && block.text.length >= 24,
  )
  const summary =
    metaSummary.length >= 24
      ? metaSummary
      : firstParagraph !== undefined && firstParagraph.blockType === "paragraph"
        ? firstParagraph.text.slice(0, 500)
        : flatText.slice(0, 500)

  return { blocks: state.blocks, summary, text: flatText, title }
}

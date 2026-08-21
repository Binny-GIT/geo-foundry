import type { Citation, ContentBlock } from "@geo/schema"

import { RENDER_ERROR, RenderError } from "./errors.js"
import type { RenderBlock } from "./model.js"
import { validateBlock } from "./validation.js"

type CitationLookup = ReadonlyMap<string, Citation>

const unsupportedBlock = (block: never): never => {
  const type = (block as { readonly type?: unknown }).type
  throw new RenderError(RENDER_ERROR.BLOCK_UNSUPPORTED, `unsupported block discriminator: ${String(type)}`)
}

const withIdentity = (block: ContentBlock): Readonly<{ readonly id?: string }> =>
  block.id === undefined ? {} : { id: block.id }

const locationOf = (block: ContentBlock, blockIndex: number, field: string) => ({
  ...(block.id === undefined ? {} : { blockId: block.id }),
  blockIndex,
  field,
})

export const renderBlock = (
  block: ContentBlock,
  blockIndex: number,
  citations: CitationLookup,
): RenderBlock => {
  validateBlock(block, blockIndex)
  switch (block.type) {
    case "paragraph":
      return { ...withIdentity(block), kind: "paragraph", text: block.text }
    case "heading":
      return { ...withIdentity(block), kind: "heading", level: block.level, text: block.text }
    case "image":
      return {
        ...withIdentity(block),
        ...(block.caption === undefined ? {} : { caption: block.caption }),
        ...(block.height === undefined ? {} : { height: block.height }),
        alt: block.alt,
        kind: "figure-image",
        src: block.src,
        ...(block.width === undefined ? {} : { width: block.width }),
      }
    case "quote":
      return {
        ...withIdentity(block),
        ...(block.attribution === undefined ? {} : { attribution: block.attribution }),
        ...(block.citeUrl === undefined ? {} : { citeUrl: block.citeUrl }),
        kind: "quote",
        text: block.text,
      }
    case "list":
      return {
        ...withIdentity(block),
        items: [...block.items],
        kind: block.style === "ordered" ? "ordered-list" : "unordered-list",
      }
    case "table":
      return {
        ...withIdentity(block),
        ...(block.caption === undefined ? {} : { caption: block.caption }),
        columns: [...block.columns],
        kind: "table",
        rows: block.rows.map((row) => [...row]),
      }
    case "faq":
      return {
        ...withIdentity(block),
        items: block.items.map((item) => ({ answer: item.answer, question: item.question })),
        kind: "faq",
      }
    case "callout":
      return {
        ...withIdentity(block),
        kind: "callout",
        text: block.text,
        ...(block.title === undefined ? {} : { title: block.title }),
        tone: block.tone,
      }
    case "code":
      return {
        ...withIdentity(block),
        ...(block.caption === undefined ? {} : { caption: block.caption }),
        code: block.code,
        kind: "code",
        language: block.language,
      }
    case "video":
      return {
        ...withIdentity(block),
        kind: "video",
        ...(block.poster === undefined ? {} : { poster: block.poster }),
        src: block.src,
        title: block.title,
        ...(block.transcript === undefined ? {} : { transcript: block.transcript }),
      }
    case "embed":
      return {
        ...withIdentity(block),
        kind: "embed",
        provider: block.provider,
        title: block.title,
        url: block.url,
      }
    case "references":
      return {
        ...withIdentity(block),
        items: block.items.map((item) => {
          const citation = citations.get(item.citationId)
          if (citation === undefined) {
            throw new RenderError(
              RENDER_ERROR.REFERENCE_UNRESOLVED,
              `reference citation does not exist: ${item.citationId}`,
              locationOf(block, blockIndex, "citationId"),
            )
          }
          return { citation, label: item.label }
        }),
        kind: "references",
      }
    default:
      return unsupportedBlock(block)
  }
}

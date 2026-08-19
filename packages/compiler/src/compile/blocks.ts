import { ContentBlockSchema, type ContentBlock } from "@geo/schema"

import { CompilerError, COMPILER_ERROR } from "./errors.js"
import type { CompileEdition, CompileMedia } from "./snapshot.js"

const mediaPathOf = (mediaId: unknown, media: readonly CompileMedia[]): CompileMedia => {
  const found =
    typeof mediaId === "string" ? media.find((entry) => entry.id === mediaId) : undefined
  if (found === undefined) {
    throw new CompilerError(
      COMPILER_ERROR.MEDIA_MISSING,
      `media reference ${String(mediaId)} has no snapshot entry`,
    )
  }
  return found
}

/**
 * Edition body blocks -> PageDocument v1 content blocks. Each candidate is
 * validated through the strict block schema; anything the contract rejects
 * (unknown block type, malformed fields, unusable levels) fails typed as an
 * unsupported block rather than being silently dropped or coerced.
 */
export const compileBlocks = (
  body: readonly unknown[],
  edition: CompileEdition,
): readonly ContentBlock[] => {
  const mediaIndex = new Map(edition.media.map((entry) => [entry.id, entry]))
  const blocks: ContentBlock[] = []
  body.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object") {
      throw new CompilerError(COMPILER_ERROR.BLOCK_UNSUPPORTED, `block ${index} is not an object`)
    }
    const candidate = raw as Record<string, unknown>
    const type = candidate["blockType"]
    const mapped: Record<string, unknown> = { ...candidate }
    delete mapped["blockType"]
    if (type !== undefined) {
      mapped["type"] = type
    }
    if (typeof candidate["level"] === "string") {
      mapped["level"] = Number(candidate["level"])
    }
    if (typeof candidate["id"] !== "string" || candidate["id"].length === 0) {
      mapped["id"] = `block-${edition.editionId}-${index}`
    }
    if (type === "image") {
      const resolved = mediaPathOf(candidate["mediaId"], [...mediaIndex.values()])
      if (mapped["src"] === undefined) {
        mapped["src"] = resolved.path
      }
      if ((mapped["alt"] === undefined || mapped["alt"] === "") && resolved.alt !== undefined) {
        mapped["alt"] = resolved.alt
      }
      if (mapped["alt"] === undefined || mapped["alt"] === "") {
        throw new CompilerError(
          COMPILER_ERROR.MEDIA_ALT_MISSING,
          `image block ${index} has no alt text in block or media snapshot`,
        )
      }
      if (mapped["width"] === undefined && resolved.width !== undefined) {
        mapped["width"] = resolved.width
      }
      if (mapped["height"] === undefined && resolved.height !== undefined) {
        mapped["height"] = resolved.height
      }
      delete mapped["mediaId"]
    }
    const parsed = ContentBlockSchema.safeParse(mapped)
    if (!parsed.success) {
      throw new CompilerError(
        COMPILER_ERROR.BLOCK_UNSUPPORTED,
        `block ${index} (${String(type)}) failed the v1 block contract: ${parsed.error.issues
          .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
          .join("; ")}`,
      )
    }
    blocks.push(parsed.data)
  })
  return blocks
}

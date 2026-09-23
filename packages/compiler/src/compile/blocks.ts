import { type ContentBlock, ContentBlockSchema } from "@geo/schema"

import { COMPILER_ERROR, CompilerError } from "./errors.js"
import type { CompileEdition, CompileMedia } from "./snapshot.js"

export const GEO_MEDIA_API_PREFIX = "/api/media/file/"
export const GEO_MEDIA_PATH_PREFIX = "/media/"

/**
 * 正文里的 geo 媒体引用归一化为站点绝对路径 `/media/<文件名>`。
 * 编辑器上传后插入的是 `/api/media/file/<文件名>`；`/media/<文件名>` 本身
 * 也接受。不是 geo 引用（外部 URL、其他相对路径）返回 null，交给调用方
 * 决定放行还是报 MEDIA_SRC_UNSUPPORTED。
 */
export const geoMediaSrcOf = (src: unknown): string | null => {
  if (typeof src !== "string") return null
  const filename = src.startsWith(GEO_MEDIA_API_PREFIX)
    ? src.slice(GEO_MEDIA_API_PREFIX.length)
    : src.startsWith(GEO_MEDIA_PATH_PREFIX)
      ? src.slice(GEO_MEDIA_PATH_PREFIX.length)
      : null
  if (filename === null) return null
  // 上传侧文件名已清洗为 [A-Za-z0-9._-]；这里只挡路径穿越，不重复校验字符集。
  if (filename.length === 0 || filename.includes("/") || filename.includes("..")) return null
  return `${GEO_MEDIA_PATH_PREFIX}${filename}`
}

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

/** 站点绝对路径下的 geo 媒体引用 → 快照条目；找不到报 MEDIA_MISSING。 */
const mediaByPathOf = (
  src: string,
  editionId: number,
  index: number,
  media: readonly CompileMedia[],
): CompileMedia => {
  const path = geoMediaSrcOf(src)
  if (path === null) {
    throw new CompilerError(
      COMPILER_ERROR.MEDIA_SRC_UNSUPPORTED,
      `image block ${index} src "${src}" is neither a geo media reference nor an external http(s) URL`,
    )
  }
  const found = media.find((entry) => entry.path === path)
  if (found === undefined) {
    throw new CompilerError(
      COMPILER_ERROR.MEDIA_MISSING,
      `image block ${index} src "${src}" of edition ${editionId} has no media snapshot entry`,
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
  const blocks: ContentBlock[] = []
  body.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object") {
      throw new CompilerError(COMPILER_ERROR.BLOCK_UNSUPPORTED, `block ${index} is not an object`)
    }
    const candidate = raw as Record<string, unknown>
    const type = candidate["blockType"]
    const mapped: Record<string, unknown> = { ...candidate }
    delete mapped["blockName"]
    delete mapped["blockType"]
    if (mapped["extensions"] === null) {
      delete mapped["extensions"]
    }
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
      const media = edition.media
      let resolved: CompileMedia | undefined
      const mediaId = candidate["mediaId"]
      if (mediaId !== undefined && typeof mediaId !== "string") {
        throw new CompilerError(
          COMPILER_ERROR.MEDIA_MISSING,
          `media reference ${String(mediaId)} has no snapshot entry`,
        )
      }
      if (typeof mediaId === "string") {
        resolved = mediaPathOf(mediaId, media)
        if (mapped["src"] === undefined) {
          mapped["src"] = resolved.path
        }
      } else {
        // 编辑器图片块只有 src：外部 http(s) 地址原样保留（仍要求 alt），
        // geo 媒体引用改写为产物内路径并核对快照条目，其他相对路径不可交付。
        const src = typeof mapped["src"] === "string" ? mapped["src"] : ""
        if (src.length === 0) {
          throw new CompilerError(
            COMPILER_ERROR.MEDIA_MISSING,
            `image block ${index} has neither mediaId nor src`,
          )
        }
        if (/^[Hh][Tt][Tt][Pp][Ss]:\/\//.test(src)) {
          // 外部图片：保留原地址，alt 只能来自块本身
        } else {
          resolved = mediaByPathOf(src, edition.editionId, index, media)
          mapped["src"] = resolved.path
        }
      }
      if ((mapped["alt"] === undefined || mapped["alt"] === "") && resolved?.alt !== undefined) {
        mapped["alt"] = resolved.alt
      }
      if (mapped["alt"] === undefined || mapped["alt"] === "") {
        throw new CompilerError(
          COMPILER_ERROR.MEDIA_ALT_MISSING,
          `image block ${index} has no alt text in block or media snapshot`,
        )
      }
      if (mapped["width"] === undefined && resolved?.width !== undefined) {
        mapped["width"] = resolved.width
      }
      if (mapped["height"] === undefined && resolved?.height !== undefined) {
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

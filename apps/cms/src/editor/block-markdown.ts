/*
 * 保护块承载无法用可读 Markdown 精确表达的区块，避免 Payload 行 ID、扩展字段及未来字段在编辑后丢失。
 */

type Row = Record<string, unknown>

type ListStyle = "ordered" | "unordered"

const PROTECTED_BLOCK_OPENING = ":::gf-block"

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/*
 * Payload 给每个区块行注入 id，并把未填写的 blockName/extensions 存成 null。
 * 这些是存储噪声而不是内容：把它们计入「额外字段」会让真实文档里的每一段
 * 都退化成保护块，Markdown 模式就失去意义。id 由 Payload 在保存时重建，
 * 因此可读映射允许丢弃；带有真实值的 extensions/blockName 仍走保护块保真。
 */
const isStorageNoise = (row: Row, key: string): boolean =>
  key === "id" || ((key === "blockName" || key === "extensions") && row[key] === null)

const hasOnlyKeys = (row: Row, allowed: readonly string[]): boolean =>
  Object.keys(row).every((key) => allowed.includes(key) || isStorageNoise(row, key))

const hasOptionalString = (row: Row, key: string): boolean =>
  !Object.hasOwn(row, key) || typeof row[key] === "string"

const stringOf = (row: Row, key: string): string | null => {
  const value = row[key]
  return typeof value === "string" ? value : null
}

const optionalStringOf = (row: Row, key: string): string | undefined => {
  const value = row[key]
  return typeof value === "string" ? value : undefined
}

const hasLineBreak = (value: string): boolean => value.includes("\r") || value.includes("\n")

const isHeadingLevel = (value: unknown): value is "2" | "3" | "4" | "5" | "6" =>
  value === "2" || value === "3" || value === "4" || value === "5" || value === "6"

const isProtectedOpening = (line: string): boolean =>
  new RegExp(`^${PROTECTED_BLOCK_OPENING}[\\t ]*$`).test(line)

const isProtectedClosing = (line: string): boolean => /^:::[\t ]*$/.test(line)

const isFencedOpening = (line: string): boolean => line.startsWith("```")

const isFencedClosing = (line: string): boolean => /^```[\t ]*$/.test(line)

/* 图片行：![alt](src) 或 ![alt](src "caption")。src 不含空白与括号，alt 不含方括号。 */
const IMAGE_LINE = /^!\[([^\][]*)\]\(([^()\s]+)(?: "([^"]*)")?\)$/

const imageMatchOf = (line: string): RegExpExecArray | null => IMAGE_LINE.exec(line)

const headingMatchOf = (line: string): RegExpExecArray | null => /^(#{2,6})[\t ](.*)$/.exec(line)

const quoteLineOf = (line: string): string | null => {
  const match = /^>[\t ]?(.*)$/.exec(line)
  return match === null ? null : (match[1] ?? "")
}

const listItemOf = (line: string): { style: ListStyle; text: string } | null => {
  const unordered = /^(?:-|\*)[\t ](.*)$/.exec(line)
  if (unordered !== null) return { style: "unordered", text: unordered[1] ?? "" }

  const ordered = /^\d+\.[\t ](.*)$/.exec(line)
  return ordered === null ? null : { style: "ordered", text: ordered[1] ?? "" }
}

const isMarkdownBlockStart = (line: string): boolean =>
  isProtectedOpening(line) ||
  isFencedOpening(line) ||
  headingMatchOf(line) !== null ||
  quoteLineOf(line) !== null ||
  listItemOf(line) !== null ||
  imageMatchOf(line) !== null

const isReadableParagraphText = (text: string): boolean => {
  if (text.length === 0 || text.includes("\r")) return false

  const lines = text.split("\n")
  return lines.every((line) => /[^\t ]/.test(line) && !isMarkdownBlockStart(line))
}

const isReadableParagraph = (row: Row): boolean =>
  row["blockType"] === "paragraph" &&
  hasOnlyKeys(row, ["blockType", "text"]) &&
  typeof row["text"] === "string" &&
  isReadableParagraphText(row["text"])

const isReadableHeading = (row: Row): boolean =>
  row["blockType"] === "heading" &&
  hasOnlyKeys(row, ["blockType", "level", "text"]) &&
  isHeadingLevel(row["level"]) &&
  typeof row["text"] === "string" &&
  !hasLineBreak(row["text"])

const isReadableQuote = (row: Row): boolean => {
  if (
    row["blockType"] !== "quote" ||
    !hasOnlyKeys(row, ["blockType", "text", "attribution", "citeUrl"]) ||
    !hasOptionalString(row, "attribution") ||
    !hasOptionalString(row, "citeUrl")
  ) {
    return false
  }

  const text = stringOf(row, "text")
  const attribution = optionalStringOf(row, "attribution")
  const citeUrl = optionalStringOf(row, "citeUrl")
  if (text === null || hasLineBreak(text)) return false
  if (attribution !== undefined && hasLineBreak(attribution)) return false
  if (citeUrl !== undefined && (hasLineBreak(citeUrl) || /[<>]/.test(citeUrl))) return false

  if (attribution === undefined && citeUrl === undefined && text.startsWith("— ")) return false
  return citeUrl !== undefined || attribution === undefined || !/^.* <[^<>]*>$/.test(attribution)
}

const isReadableListItem = (value: unknown): value is Row =>
  isRow(value) &&
  hasOnlyKeys(value, ["text"]) &&
  typeof value["text"] === "string" &&
  !hasLineBreak(value["text"])

const isReadableList = (row: Row): boolean =>
  row["blockType"] === "list" &&
  hasOnlyKeys(row, ["blockType", "style", "items"]) &&
  (row["style"] === "ordered" || row["style"] === "unordered") &&
  Array.isArray(row["items"]) &&
  row["items"].length > 0 &&
  row["items"].every(isReadableListItem)

/* 图片按标准 Markdown 语法可读化；带 width/height 等额外字段的仍走保护块保真。 */
const isReadableImage = (row: Row): boolean => {
  if (
    row["blockType"] !== "image" ||
    !hasOnlyKeys(row, ["blockType", "src", "alt", "caption"])
  ) {
    return false
  }
  const src = stringOf(row, "src")
  const alt = stringOf(row, "alt")
  const caption = optionalStringOf(row, "caption")
  return (
    src !== null &&
    alt !== null &&
    !/\s/.test(src) &&
    !/[()]/.test(src) &&
    !hasLineBreak(alt) &&
    !/[[\]]/.test(alt) &&
    (caption === undefined || (!hasLineBreak(caption) && !/"/.test(caption)))
  )
}

const isReadableCode = (row: Row): boolean => {
  if (
    row["blockType"] !== "code" ||
    !hasOnlyKeys(row, ["blockType", "language", "code", "caption"]) ||
    !hasOptionalString(row, "caption")
  ) {
    return false
  }

  const language = stringOf(row, "language")
  const code = stringOf(row, "code")
  const caption = optionalStringOf(row, "caption")
  return (
    language !== null &&
    code !== null &&
    !hasLineBreak(language) &&
    !code.includes("\r") &&
    !code.split("\n").some(isFencedClosing) &&
    (caption === undefined || !hasLineBreak(caption))
  )
}

const quoteAttributionLineOf = (
  attribution: string | undefined,
  citeUrl: string | undefined,
): string => {
  if (citeUrl === undefined) return `> — ${attribution ?? ""}`
  if (attribution === undefined) return `> — <${citeUrl}>`
  return `> — ${attribution} <${citeUrl}>`
}

const readableMarkdownOf = (row: Row): string | null => {
  if (isReadableParagraph(row)) return stringOf(row, "text")

  if (isReadableHeading(row)) {
    const level = stringOf(row, "level")
    const text = stringOf(row, "text")
    return level === null || text === null ? null : `${"#".repeat(Number(level))} ${text}`
  }

  if (isReadableQuote(row)) {
    const text = stringOf(row, "text")
    const attribution = optionalStringOf(row, "attribution")
    const citeUrl = optionalStringOf(row, "citeUrl")
    if (text === null) return null
    if (attribution === undefined && citeUrl === undefined) return `> ${text}`
    return [`> ${text}`, quoteAttributionLineOf(attribution, citeUrl)].join("\n")
  }

  if (isReadableList(row)) {
    const style = row["style"]
    const items = row["items"]
    if ((style !== "ordered" && style !== "unordered") || !Array.isArray(items)) return null

    return items
      .map((item, index) => {
        const text = isRow(item) ? stringOf(item, "text") : null
        if (text === null) return null
        return style === "ordered" ? `${index + 1}. ${text}` : `- ${text}`
      })
      .every((line): line is string => line !== null)
      ? items
          .map((item, index) => {
            const text = isRow(item) ? stringOf(item, "text") : null
            return text === null ? "" : style === "ordered" ? `${index + 1}. ${text}` : `- ${text}`
          })
          .join("\n")
      : null
  }

  if (isReadableCode(row)) {
    const language = stringOf(row, "language")
    const code = stringOf(row, "code")
    const caption = optionalStringOf(row, "caption")
    if (language === null || code === null) return null

    return [
      `\`\`\`${language}`,
      code,
      "```",
      ...(caption === undefined ? [] : [`*${caption}*`]),
    ].join("\n")
  }

  if (isReadableImage(row)) {
    const src = stringOf(row, "src")
    const alt = stringOf(row, "alt")
    const caption = optionalStringOf(row, "caption")
    if (src === null || alt === null) return null
    return caption === undefined ? `![${alt}](${src})` : `![${alt}](${src} "${caption}")`
  }

  return null
}

const protectedMarkdownOf = (row: Row): string | null => {
  const json = JSON.stringify(row)
  return json === undefined ? null : [PROTECTED_BLOCK_OPENING, json, ":::"].join("\n")
}

const blockMarkdownOf = (value: unknown): string | null => {
  try {
    if (!isRow(value)) return null
    return readableMarkdownOf(value) ?? protectedMarkdownOf(value)
  } catch {
    return null
  }
}

const paragraphOf = (text: string): Row => ({ blockType: "paragraph", text })

const protectedSegmentAt = (
  lines: readonly string[],
  startIndex: number,
): { block: Row; nextIndex: number } => {
  let closingIndex = startIndex + 1
  while (closingIndex < lines.length) {
    if (isProtectedClosing(lines[closingIndex] ?? "")) {
      const raw = lines.slice(startIndex, closingIndex + 1).join("\n")
      const json = lines.slice(startIndex + 1, closingIndex).join("\n")
      try {
        const value: unknown = JSON.parse(json)
        return {
          block: isRow(value) ? value : paragraphOf(raw),
          nextIndex: closingIndex + 1,
        }
      } catch {
        return { block: paragraphOf(raw), nextIndex: closingIndex + 1 }
      }
    }
    closingIndex += 1
  }

  return { block: paragraphOf(lines.slice(startIndex).join("\n")), nextIndex: lines.length }
}

const fencedCodeSegmentAt = (
  lines: readonly string[],
  startIndex: number,
): { block: Row; nextIndex: number } => {
  let closingIndex = startIndex + 1
  while (closingIndex < lines.length) {
    if (isFencedClosing(lines[closingIndex] ?? "")) {
      const captionLine = lines[closingIndex + 1]
      const captionMatch = captionLine === undefined ? null : /^\*(.*)\*$/.exec(captionLine)
      const language = (lines[startIndex] ?? "").slice(3)
      const code = lines.slice(startIndex + 1, closingIndex).join("\n")
      return {
        block: {
          blockType: "code",
          code,
          language,
          ...(captionMatch === null ? {} : { caption: captionMatch[1] ?? "" }),
        },
        nextIndex: closingIndex + (captionMatch === null ? 1 : 2),
      }
    }
    closingIndex += 1
  }

  return { block: paragraphOf(lines.slice(startIndex).join("\n")), nextIndex: lines.length }
}

const quoteBlockOf = (quoteLines: readonly string[]): Row => {
  const lastLine = quoteLines.at(-1)
  if (lastLine === undefined || !lastLine.startsWith("— ")) {
    return { blockType: "quote", text: quoteLines.join("\n") }
  }

  const metadata = lastLine.slice(2)
  const text = quoteLines.slice(0, -1).join("\n")
  if (/^<[^<>]*>$/.test(metadata)) {
    return { blockType: "quote", citeUrl: metadata.slice(1, -1), text }
  }

  const citationMatch = /^(.*) <([^<>]*)>$/.exec(metadata)
  if (citationMatch !== null) {
    return {
      attribution: citationMatch[1] ?? "",
      blockType: "quote",
      citeUrl: citationMatch[2] ?? "",
      text,
    }
  }

  return { attribution: metadata, blockType: "quote", text }
}

export const markdownToBlocks = (markdown: string): Record<string, unknown>[] => {
  if (typeof markdown !== "string") return []

  try {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
    const blocks: Row[] = []
    let index = 0

    while (index < lines.length) {
      const line = lines[index] ?? ""
      if (/^[\t ]*$/.test(line)) {
        index += 1
        continue
      }

      if (isProtectedOpening(line)) {
        const segment = protectedSegmentAt(lines, index)
        blocks.push(segment.block)
        index = segment.nextIndex
        continue
      }

      if (isFencedOpening(line)) {
        const segment = fencedCodeSegmentAt(lines, index)
        blocks.push(segment.block)
        index = segment.nextIndex
        continue
      }

      const imageMatch = imageMatchOf(line)
      if (imageMatch !== null) {
        blocks.push({
          alt: imageMatch[1] ?? "",
          blockType: "image",
          src: imageMatch[2] ?? "",
          ...(imageMatch[3] === undefined ? {} : { caption: imageMatch[3] }),
        })
        index += 1
        continue
      }

      const headingMatch = headingMatchOf(line)
      if (headingMatch !== null) {
        blocks.push({
          blockType: "heading",
          level: String((headingMatch[1] ?? "").length),
          text: headingMatch[2] ?? "",
        })
        index += 1
        continue
      }

      const firstQuoteLine = quoteLineOf(line)
      if (firstQuoteLine !== null) {
        const quoteLines = [firstQuoteLine]
        index += 1
        while (index < lines.length) {
          const quoteLine = quoteLineOf(lines[index] ?? "")
          if (quoteLine === null) break
          quoteLines.push(quoteLine)
          index += 1
        }
        blocks.push(quoteBlockOf(quoteLines))
        continue
      }

      const firstListItem = listItemOf(line)
      if (firstListItem !== null) {
        const items = [{ text: firstListItem.text }]
        index += 1
        while (index < lines.length) {
          const item = listItemOf(lines[index] ?? "")
          if (item === null || item.style !== firstListItem.style) break
          items.push({ text: item.text })
          index += 1
        }
        blocks.push({ blockType: "list", items, style: firstListItem.style })
        continue
      }

      const startIndex = index
      index += 1
      while (index < lines.length && !/^[\t ]*$/.test(lines[index] ?? "")) index += 1
      blocks.push(paragraphOf(lines.slice(startIndex, index).join("\n")))
    }

    return blocks
  } catch {
    return []
  }
}

export const blocksToMarkdown = (blocks: readonly unknown[]): string => {
  if (!Array.isArray(blocks)) return ""

  try {
    return blocks
      .map(blockMarkdownOf)
      .filter((markdown): markdown is string => markdown !== null)
      .join("\n\n")
  } catch {
    return ""
  }
}

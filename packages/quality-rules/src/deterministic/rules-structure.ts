import {
  ContentBlockSchema,
  type ArticlePage,
  type ContentBlock,
  type PageDocument,
} from "@geo/schema"

import type { QualityIssue } from "./issue.js"

export const MIN_CONTENT_CHARS = 300

export type StructureRuleInput = {
  readonly blocks: readonly ContentBlock[]
  readonly heroImageAlt: string | undefined
  readonly isProse: boolean
}

const blockIssue = (
  code: string,
  severity: QualityIssue["severity"],
  block: { readonly id?: string },
  blockIndex: number,
  message: string,
  recommendation: string,
): QualityIssue => ({
  code,
  location: {
    field: `body[${blockIndex}]`,
    ...(block.id === undefined ? {} : { blockId: block.id }),
    blockIndex,
  },
  message,
  recommendation,
  severity,
})

const textBlocksOf = (blocks: readonly ContentBlock[]): readonly string[] =>
  blocks.flatMap((block) => {
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "quote":
      case "callout":
        return [block.text]
      case "list":
        return [...block.items]
      case "table":
        return [...block.columns, ...block.rows.flat()]
      case "faq":
        return block.items.flatMap((item) => [item.question, item.answer])
      case "code":
        return [block.code]
      case "image":
      case "video":
      case "embed":
      case "references":
        return []
      default:
        return []
    }
  })

export const blockRules = (input: StructureRuleInput): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  input.blocks.forEach((block, index) => {
    const identified = block as { readonly id?: string }
    if (!ContentBlockSchema.safeParse(block).success) {
      issues.push(
        blockIssue(
          "BLOCK_MALFORMED",
          "critical",
          identified,
          index,
          `Block ${index} does not satisfy the PageDocument block schema`,
          "Fix or drop the block before quality evaluation",
        ),
      )
      return
    }
  })
  if (input.heroImageAlt !== undefined && input.heroImageAlt.trim().length === 0) {
    issues.push({
      code: "IMAGE_ALT_MISSING",
      location: { field: "hero.image.alt" },
      message: "Hero image has an empty alt text",
      recommendation: "Describe the hero image",
      severity: "major",
    })
  }
  return issues
}

export const headingRules = (input: StructureRuleInput): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  const headings = input.blocks
    .map((block, index) => ({ block, index }))
    .filter(
      (entry): entry is { block: Extract<ContentBlock, { type: "heading" }>; index: number } => {
        const parsed = ContentBlockSchema.safeParse(entry.block)
        return parsed.success && entry.block.type === "heading"
      },
    )

  if (input.isProse && headings.length === 0) {
    issues.push({
      code: "HEADING_MISSING",
      location: { field: "body" },
      message: "Prose page has no heading block",
      recommendation: "Add at least one level-2 section heading",
      severity: "major",
    })
    return issues
  }
  const firstHeading = headings[0]
  if (firstHeading !== undefined && firstHeading.block.level !== 2) {
    issues.push({
      code: "HEADING_FIRST_LEVEL_INVALID",
      location: { blockIndex: firstHeading.index, field: `body[${firstHeading.index}]` },
      message: `First heading level is ${firstHeading.block.level}`,
      recommendation: "Start sections at level 2; the page title is the h1",
      severity: "major",
    })
  }
  let previousHeading: (typeof headings)[number] | undefined
  for (const current of headings) {
    if (previousHeading !== undefined && current.block.level > previousHeading.block.level + 1) {
      issues.push({
        code: "HEADING_LEVEL_SKIPPED",
        location: { blockIndex: current.index, field: `body[${current.index}]` },
        message: `Heading level jumped from ${previousHeading.block.level} to ${current.block.level}`,
        recommendation: "Keep heading levels incremental",
        severity: "major",
      })
    }
    previousHeading = current
  }
  const seenHeadingText = new Set<string>()
  for (const heading of headings) {
    const key = heading.block.text.trim().toLowerCase()
    if (seenHeadingText.has(key)) {
      issues.push({
        code: "HEADING_DUPLICATED",
        location: { blockIndex: heading.index, field: `body[${heading.index}]` },
        message: `Duplicate heading text: ${heading.block.text.trim()}`,
        recommendation: "Reword repeated section headings",
        severity: "minor",
      })
    } else {
      seenHeadingText.add(key)
    }
  }
  return issues
}

export const contentLengthRule = (input: StructureRuleInput): readonly QualityIssue[] => {
  if (!input.isProse) {
    return []
  }
  const chars = textBlocksOf(input.blocks)
    .map((text) => text.trim())
    .join(" ").length
  if (chars < MIN_CONTENT_CHARS) {
    return [
      {
        code: "CONTENT_TOO_SHORT",
        location: { field: "body" },
        message: `Prose content is ${chars} characters (min ${MIN_CONTENT_CHARS})`,
        recommendation: "Expand the body to a substantive article length",
        severity: "major",
      },
    ]
  }
  return []
}

export const structureInputOf = (
  document: Exclude<PageDocument, { pageType: "redirect" }>,
): StructureRuleInput => ({
  blocks: (document as ArticlePage).body,
  heroImageAlt:
    document.hero?.image === undefined ? undefined : String(document.hero.image.alt ?? ""),
  isProse: document.pageType === "article" || document.pageType === "not-found",
})

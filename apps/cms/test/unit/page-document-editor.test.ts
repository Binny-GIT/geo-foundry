import { describe, expect, it } from "vitest"

import { PAGE_DOCUMENT_BLOCKS } from "../../src/editor/page-document-blocks"

const labelOf = (value: unknown, language: "en" | "zh"): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[language] : value

const expectedBlocks = [
  ["paragraph", "Paragraph"],
  ["heading", "Heading"],
  ["image", "Image"],
  ["quote", "Quote"],
  ["list", "List"],
  ["table", "Table"],
  ["faq", "FAQ"],
  ["callout", "Callout"],
  ["code", "Code"],
  ["video", "Video"],
  ["embed", "Embed"],
  ["references", "References"],
] as const

describe("PageDocument Lexical blocks", () => {
  it("Given the PageDocument contract, when editor blocks are listed, then every required block maps exactly once", () => {
    const actual = PAGE_DOCUMENT_BLOCKS.map((block) => [
      block.slug,
      labelOf(block.labels.singular, "en"),
    ])

    expect(actual).toEqual(expectedBlocks)
  })

  it("Given the localized editor schema, when blocks are inspected, then every block and field has English and Chinese labels", () => {
    for (const block of PAGE_DOCUMENT_BLOCKS) {
      expect(labelOf(block.labels.singular, "en")).toEqual(expect.any(String))
      expect(labelOf(block.labels.singular, "zh")).toEqual(expect.any(String))
      for (const field of block.fields) {
        if ("name" in field && field.name !== undefined) {
          const label = "label" in field ? field.label : undefined
          expect(labelOf(label, "en")).toEqual(expect.any(String))
          expect(labelOf(label, "zh")).toEqual(expect.any(String))
        }
      }
    }
  })

  it("Given the PageDocument block mapping, when fields are inspected, then every block carries a collapsed extensions escape hatch", () => {
    const blocksWithoutExtensions = PAGE_DOCUMENT_BLOCKS.filter(
      (block) =>
        !block.fields.some(
          (field) =>
            field.type === "collapsible" &&
            field.admin?.initCollapsed === true &&
            field.fields.some((nested) => "name" in nested && nested.name === "extensions"),
        ),
    )

    expect(blocksWithoutExtensions).toEqual([])
  })
})

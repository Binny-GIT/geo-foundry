import { describe, expect, it } from "vitest"

import { PAGE_DOCUMENT_BLOCKS } from "../../src/editor/page-document-blocks"

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
    const actual = PAGE_DOCUMENT_BLOCKS.map((block) => [block.slug, block.labels.singular])

    expect(actual).toEqual(expectedBlocks)
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

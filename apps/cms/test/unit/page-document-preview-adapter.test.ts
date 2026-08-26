import { describe, expect, it } from "vitest"

import {
  previewBlockOf,
  previewDocumentOf,
} from "../../src/components/content-edition/page-document-preview-adapter"

describe("content edition preview adapter", () => {
  it("normalizes stored Payload blocks into a strict preview document", () => {
    const result = previewDocumentOf({
      body: [
        { blockName: null, blockType: "heading", id: "row-1", level: "2", text: "Preview title" },
        { blockType: "list", id: "row-2", items: [{ id: "item-1", text: "One" }], style: "unordered" },
      ],
      contentId: 8,
      editionId: 12,
      siteId: 4,
      summary: "Preview summary",
      title: "Preview title",
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.document.pageType === "redirect") return
    expect(result.document.metadata).toMatchObject({
      description: "Preview summary",
      title: "Preview title",
    })
    expect(result.document.body).toEqual([
      { level: 2, text: "Preview title", type: "heading" },
      { items: ["One"], style: "unordered", type: "list" },
    ])
  })

  it("returns a safe validation state instead of guessing invalid preview content", () => {
    const result = previewDocumentOf({
      body: [{ blockType: "embed", provider: "example", title: "Broken", url: "not-a-url" }],
      editionId: 12,
      summary: "Preview summary",
      title: "Preview title",
    })

    expect(result).toMatchObject({ ok: false })
  })

  it("removes storage-only IDs while preserving block-specific fields", () => {
    expect(
      previewBlockOf({
        blockName: "intro",
        blockType: "quote",
        extensions: null,
        id: "row-9",
        text: "A quote",
      }),
    ).toEqual({ text: "A quote", type: "quote" })
  })
})

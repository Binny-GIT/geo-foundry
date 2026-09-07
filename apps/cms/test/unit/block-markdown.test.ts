import { describe, expect, it } from "vitest"

import { blocksToMarkdown, markdownToBlocks } from "../../src/editor/block-markdown"

describe("block markdown", () => {
  it("renders the supported block types as readable Markdown", () => {
    const markdown = blocksToMarkdown([
      { blockType: "heading", level: "2", text: "Overview" },
      { blockType: "paragraph", text: "A readable paragraph." },
      {
        attribution: "Ada Lovelace",
        blockType: "quote",
        citeUrl: "https://example.com/source",
        text: "The analytical engine weaves algebraic patterns.",
      },
      { blockType: "list", items: [{ text: "First" }, { text: "Second" }], style: "ordered" },
      { blockType: "list", items: [{ text: "Alpha" }, { text: "Beta" }], style: "unordered" },
      { blockType: "code", caption: "A small example", code: "const answer = 42", language: "ts" },
    ])

    expect(markdown).toBe(`## Overview

A readable paragraph.

> The analytical engine weaves algebraic patterns.
> — Ada Lovelace <https://example.com/source>

1. First
2. Second

- Alpha
- Beta

\`\`\`ts
const answer = 42
\`\`\`
*A small example*`)

    expect(markdownToBlocks(markdown)).toEqual([
      { blockType: "heading", level: "2", text: "Overview" },
      { blockType: "paragraph", text: "A readable paragraph." },
      {
        attribution: "Ada Lovelace",
        blockType: "quote",
        citeUrl: "https://example.com/source",
        text: "The analytical engine weaves algebraic patterns.",
      },
      { blockType: "list", items: [{ text: "First" }, { text: "Second" }], style: "ordered" },
      { blockType: "list", items: [{ text: "Alpha" }, { text: "Beta" }], style: "unordered" },
      { blockType: "code", caption: "A small example", code: "const answer = 42", language: "ts" },
    ])
  })

  it("uses protected blocks for non-readable fields and preserves every Payload block exactly", () => {
    const blocks = [
      {
        blockType: "paragraph",
        extensions: { locale: "zh-CN" },
        id: "paragraph-1",
        text: "Stored",
      },
      { blockType: "heading", id: "heading-1", level: "3", text: "Stored heading" },
      {
        alt: "A diagram",
        blockType: "image",
        caption: "Figure one",
        extensions: { focalPoint: "center" },
        height: 400,
        id: "image-1",
        src: "https://example.com/image.png",
        width: 640,
      },
      {
        attribution: "Author",
        blockType: "quote",
        citeUrl: "https://example.com/citation",
        extensions: null,
        id: "quote-1",
        text: "Stored quote",
      },
      {
        blockType: "list",
        id: "list-1",
        items: [{ id: "list-item-1", text: "Stored item" }],
        style: "unordered",
      },
      {
        blockType: "table",
        caption: "Table caption",
        columns: [{ id: "column-1", text: "Column" }],
        id: "table-1",
        rows: [{ cells: [{ id: "cell-1", text: "Value" }], id: "row-1" }],
      },
      {
        blockType: "faq",
        id: "faq-1",
        items: [{ answer: "Answer", id: "faq-item-1", question: "Question" }],
      },
      {
        blockType: "callout",
        id: "callout-1",
        text: "Take care",
        title: "Notice",
        tone: "warning",
      },
      {
        blockType: "code",
        caption: "Stored code",
        code: "console.log('stored')",
        extensions: { source: "import" },
        id: "code-1",
        language: "ts",
      },
      {
        blockType: "video",
        id: "video-1",
        poster: "https://example.com/poster.jpg",
        src: "https://example.com/video.mp4",
        title: "Demo",
        transcript: "Transcript",
      },
      {
        blockType: "embed",
        extensions: { autoplay: false },
        id: "embed-1",
        provider: "YouTube",
        title: "Embed",
        url: "https://example.com/embed",
      },
      {
        blockType: "references",
        id: "references-1",
        items: [{ citationId: "source-1", id: "reference-1", label: "Reference one" }],
      },
      { blockType: "future-widget", id: "future-1", nested: { items: [1, 2, 3] } },
    ]

    const markdown = blocksToMarkdown(blocks)

    expect(markdown).toContain(":::gf-block")
    expect(markdown).toContain('"id":"paragraph-1"')
    expect(markdownToBlocks(markdown)).toEqual(blocks)
  })

  it("parses handwritten Markdown despite blank lines, trailing spaces, and CRLF", () => {
    expect(
      markdownToBlocks(
        "\r\n  \r\n## Heading  \r\n\r\nPlain line  \r\nsecond line\r\n\r\n> Quote\r\n> — Ada <https://example.com/a>\r\n\r\n- One  \r\n- Two\r\n\r\n```js\r\nconst value = 1\r\n```\r\n*Example*\r\n",
      ),
    ).toEqual([
      { blockType: "heading", level: "2", text: "Heading  " },
      { blockType: "paragraph", text: "Plain line  \nsecond line" },
      { attribution: "Ada", blockType: "quote", citeUrl: "https://example.com/a", text: "Quote" },
      { blockType: "list", items: [{ text: "One  " }, { text: "Two" }], style: "unordered" },
      { blockType: "code", caption: "Example", code: "const value = 1", language: "js" },
    ])
  })

  it("keeps malformed protected and unclosed fenced blocks as paragraphs instead of throwing", () => {
    expect(
      markdownToBlocks(`:::gf-block
{"blockType":"image",
:::

\`\`\`ts
const incomplete = true`),
    ).toEqual([
      { blockType: "paragraph", text: ':::gf-block\n{"blockType":"image",\n:::' },
      { blockType: "paragraph", text: "```ts\nconst incomplete = true" },
    ])
  })

  it("returns empty results for invalid top-level input", () => {
    expect(blocksToMarkdown(null as unknown as readonly unknown[])).toBe("")
    expect(markdownToBlocks(null as unknown as string)).toEqual([])
  })
})

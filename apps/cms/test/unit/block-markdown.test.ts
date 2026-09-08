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

  it("round-trips plain images through standard Markdown image syntax", () => {
    const blocks = [
      { alt: "架构图", blockType: "image", src: "https://example.com/a.png" },
      { alt: "Julian Laxman", blockType: "image", caption: "作者照片", src: "https://example.com/p.jpg?w=64&h=64&fit=cover" },
      { alt: "", blockType: "image", src: "https://example.com/b.png" },
    ]
    const markdown = blocksToMarkdown(blocks)
    expect(markdown).toContain("![架构图](https://example.com/a.png)")
    expect(markdown).toContain(
      '![Julian Laxman](https://example.com/p.jpg?w=64&h=64&fit=cover "作者照片")',
    )
    expect(markdown).toContain("![](https://example.com/b.png)")
    expect(markdownToBlocks(markdown)).toEqual(blocks)
  })

  it("keeps images with dimensions or hostile text as protected blocks", () => {
    const blocks = [
      { alt: "带尺寸", blockType: "image", height: 400, src: "https://example.com/s.png", width: 640 },
      { alt: "空格URL", blockType: "image", src: "https://example.com/a b.png" },
      { alt: '引号caption', blockType: "image", caption: '他说 "hi"', src: "https://example.com/q.png" },
    ]
    const markdown = blocksToMarkdown(blocks)
    expect(markdown).toContain(":::gf-block")
    expect(markdownToBlocks(markdown)).toEqual(blocks)
  })

  it("parses a handwritten image line between paragraphs", () => {
    expect(
      markdownToBlocks("开头段落。\n\n![示意图](https://example.com/d.png \"图一\")\n\n结尾段落。"),
    ).toEqual([
      { blockType: "paragraph", text: "开头段落。" },
      { alt: "示意图", blockType: "image", caption: "图一", src: "https://example.com/d.png" },
      { blockType: "paragraph", text: "结尾段落。" },
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

  it("keeps stored rows readable when they only carry Payload row noise", () => {
    // Real documents always carry a row id plus null blockName/extensions;
    // those must not push every paragraph into a protected block.
    const stored = [
      {
        blockName: null,
        blockType: "heading",
        extensions: null,
        id: "a",
        level: "3",
        text: "标题",
      },
      { blockName: null, blockType: "paragraph", extensions: null, id: "b", text: "正文段落" },
      {
        blockName: null,
        blockType: "list",
        extensions: null,
        id: "c",
        items: [{ id: "c1", text: "第一项" }],
        style: "ordered",
      },
    ]

    const markdown = blocksToMarkdown(stored)

    expect(markdown).not.toContain(":::gf-block")
    expect(markdown).toContain("### 标题")
    // The row id is machine-owned and rebuilt on save, so content survives.
    expect(markdownToBlocks(markdown)).toEqual([
      { blockType: "heading", level: "3", text: "标题" },
      { blockType: "paragraph", text: "正文段落" },
      { blockType: "list", items: [{ text: "第一项" }], style: "ordered" },
    ])
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

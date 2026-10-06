import { ArticlePageSchema } from "@geo/schema"
import { describe, expect, it } from "vitest"

import { draftDocumentOf } from "../../src/pipelines/draft-document.js"

const documentOf = (body: readonly unknown[]) =>
  draftDocumentOf({
    body,
    contentId: 12,
    pathname: "/drafts/101",
    siteId: "site-a",
    summary: "草稿正文转换",
    title: "要点",
  })

describe("draftDocumentOf", () => {
  it.each(["unordered", "ordered"])("flattens editor %s list items", (style) => {
    const body = [{ blockType: "list", items: [{ text: "第一项" }, { text: "第二项" }], style }]

    const document = ArticlePageSchema.parse(documentOf(body))

    expect(document.body).toEqual([
      { id: "generated-block-0", items: ["第一项", "第二项"], style, type: "list" },
    ])
  })

  it("preserves heading, list and paragraph order in a mixed body", () => {
    const body = [
      { blockType: "heading", level: "2", text: "要点" },
      { blockType: "list", items: [{ text: "第一项" }, { text: "第二项" }], style: "unordered" },
      { blockType: "paragraph", text: "结尾段落。" },
    ]

    const document = ArticlePageSchema.parse(documentOf(body))

    expect(document.body).toEqual([
      { id: "generated-block-0", level: 2, text: "要点", type: "heading" },
      { id: "generated-block-1", items: ["第一项", "第二项"], style: "unordered", type: "list" },
      { id: "generated-block-2", text: "结尾段落。", type: "paragraph" },
    ])
  })

  it("preserves list items that are already strings", () => {
    const body = [{ blockType: "list", items: ["第一项", "第二项"], style: "unordered" }]

    const document = ArticlePageSchema.parse(documentOf(body))

    expect(document.body[0]).toMatchObject({ items: ["第一项", "第二项"], type: "list" })
  })

  it("normalizes object items alongside existing string items", () => {
    const body = [{ blockType: "list", items: ["第一项", { text: "第二项" }], style: "ordered" }]

    const document = ArticlePageSchema.parse(documentOf(body))

    expect(document.body[0]).toMatchObject({ items: ["第一项", "第二项"], style: "ordered" })
  })

  it.each([null, 42, { text: 42 }, { label: "不是文本" }])(
    "leaves invalid list item %j for schema validation",
    (item) => {
      const body = [{ blockType: "list", items: [item], style: "unordered" }]

      const convert = () => documentOf(body)

      expect(convert).toThrow("Invalid input: expected string")
    },
  )

  it("preserves callout fields from a protected JSON block", () => {
    const body = [{ blockType: "callout", text: "注意事项", title: "提示", tone: "warning" }]

    const document = ArticlePageSchema.parse(documentOf(body))

    expect(document.body[0]).toEqual({
      id: "generated-block-0",
      text: "注意事项",
      title: "提示",
      tone: "warning",
      type: "callout",
    })
  })

  it.each([
    { blockType: "heading", level: "2", text: "要点" },
    { blockType: "paragraph", text: "正文。" },
    { blockType: "quote", text: "引文" },
    { attribution: "作者", blockType: "quote", text: "引文" },
    { blockType: "quote", citeUrl: "https://example.com/source", text: "引文" },
    {
      attribution: "作者",
      blockType: "quote",
      citeUrl: "https://example.com/source",
      text: "引文",
    },
    {
      alt: "示意图",
      blockType: "image",
      caption: "图一",
      src: "https://example.com/image.png",
    },
    { blockType: "code", caption: "示例", code: "const answer = 42", language: "ts" },
    { blockType: "faq", items: [{ answer: "Answer", question: "Question" }] },
    {
      blockType: "embed",
      provider: "YouTube",
      title: "Embed",
      url: "https://example.com/embed",
    },
    {
      blockType: "video",
      poster: "https://example.com/poster.jpg",
      src: "https://example.com/video.mp4",
      title: "Demo",
      transcript: "Transcript",
    },
    { blockType: "references", items: [{ citationId: "source-1", label: "Reference one" }] },
  ])("preserves compatible editor block $blockType", (block) => {
    const { blockType, ...fields } = block

    const document = ArticlePageSchema.parse(documentOf([block]))

    expect(document.body[0]).toEqual({
      ...fields,
      id: "generated-block-0",
      type: blockType,
      ...(blockType === "heading" ? { level: 2 } : {}),
    })
  })
})

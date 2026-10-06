import { compileSite } from "@geo/compiler"
import { ArticlePageSchema } from "@geo/schema"
import { describe, expect, it } from "vitest"

import { markdownToBlocks } from "../../src/editor/block-markdown"
import { deriveListings, mapEdition } from "../../src/services/compile-snapshot-mappers"

const compileBody = async (body: readonly unknown[]) => {
  const edition = mapEdition({
    assessment: { inputHash: "a".repeat(64), state: "passed" },
    canonicalDomain: "example.test",
    edition: {
      body: [...body],
      createdAt: "2026-10-06T00:00:00.000Z",
      id: 42,
      summary: "编译正文测试",
      title: "编译正文测试",
      updatedAt: "2026-10-06T00:00:00.000Z",
    },
    media: [],
    siteKey: "site-1",
    urlPathname: "/articles/edition-42",
  })
  if (edition === null) throw new Error("测试夹具未生成文章")
  const output = await compileSite({
    clock: { now: "2026-10-06T00:00:00.000Z" },
    compilerVersion: "test",
    editions: [edition],
    listings: {
      articles: { pageSize: 20, pathname: "/articles" },
      ...deriveListings([edition]),
    },
    notFound: { pathname: "/not-found" },
    redirects: [],
    site: {
      canonicalDomain: "example.test",
      locale: "zh-CN",
      name: "测试站",
      organization: { name: "测试站" },
      seoDefaults: { description: "编译正文测试", title: "测试站" },
      siteId: "site-1",
      timezone: "UTC",
    },
  })
  const article = output.documents.find((entry) => entry.pathname === edition.urlPathname)
  if (article === undefined) throw new Error("未生成文章产物")
  return ArticlePageSchema.parse(JSON.parse(article.canonical)).body
}

describe("编译快照列表回归", () => {
  it.each([
    { name: "无序列表", markdown: "- 要点一\n- 要点二", style: "unordered" },
    { name: "有序列表", markdown: "1. 要点一\n2. 要点二", style: "ordered" },
  ])("$name 经 Markdown 和真实 compileSite 编译为字符串列表", async ({ markdown, style }) => {
    const body = markdownToBlocks(markdown)

    const compiled = await compileBody(body)

    expect(compiled).toEqual([
      expect.objectContaining({ type: "list", style, items: ["要点一", "要点二"] }),
    ])
  })

  it("标题、四项列表与段落混合正文经过真实 compileSite", async () => {
    const body = markdownToBlocks("## 要点\n\n- 一\n- 二\n- 三\n- 四\n\n后续段落。")

    const compiled = await compileBody(body)

    expect(compiled).toEqual([
      expect.objectContaining({ type: "heading", level: 2, text: "要点" }),
      expect.objectContaining({ type: "list", items: ["一", "二", "三", "四"] }),
      expect.objectContaining({ type: "paragraph", text: "后续段落。" }),
    ])
  })

  it("字符串列表项原样保留并展平带行 id 的文本项", async () => {
    const body = [
      { blockType: "list", style: "unordered", items: ["一", { id: "row-1", text: "二" }] },
    ]

    const compiled = await compileBody(body)

    expect(compiled[0]).toMatchObject({ items: ["一", "二"] })
  })

  it.each([1, null, { text: 1 }, { label: "非法项" }])(
    "非法列表项 %j 仍被合同拒绝",
    async (item) => {
      const body = [{ blockType: "list", style: "unordered", items: [{ text: "合法项" }, item] }]

      await expect(compileBody(body)).rejects.toThrow(/COMPILER_BLOCK_UNSUPPORTED:.*items\.1:/)
    },
  )
})

const protectedMarkdown = (block: Readonly<Record<string, unknown>>) =>
  `:::gf-block\n${JSON.stringify(block)}\n:::`

const compilableBlocks = [
  { name: "heading", markdown: "## 标题", type: "heading" },
  { name: "paragraph", markdown: "正文段落。", type: "paragraph" },
  { name: "quote 无归属", markdown: "> 引文", type: "quote" },
  { name: "quote attribution", markdown: "> 引文\n> — 作者", type: "quote" },
  { name: "quote citeUrl", markdown: "> 引文\n> — <https://example.test/source>", type: "quote" },
  {
    name: "quote attribution + citeUrl",
    markdown: "> 引文\n> — 作者 <https://example.test/source>",
    type: "quote",
  },
  { name: "image", markdown: '![替代文本](https://example.test/photo.jpg "说明")', type: "image" },
  { name: "code 有语言", markdown: "```ts\nconst n = 1\n```", type: "code" },
  ...[
    { blockType: "table", columns: ["列"], rows: [["值"]], caption: "表格" },
    { blockType: "faq", items: [{ question: "问题", answer: "回答" }] },
    { blockType: "embed", provider: "YouTube", url: "https://example.test/embed", title: "嵌入" },
    {
      blockType: "video",
      src: "https://example.test/video.mp4",
      title: "视频",
      poster: "https://example.test/poster.jpg",
      transcript: "文字稿",
    },
    { blockType: "callout", tone: "warning", title: "注意", text: "提示正文" },
    { blockType: "references", items: [{ citationId: "source-1", label: "参考资料" }] },
  ].map((block) => ({
    name: `gf-block ${block.blockType}`,
    markdown: protectedMarkdown(block),
    type: block.blockType,
  })),
]

const rejectedBlocks = [
  { name: "code 无语言", markdown: "```\nconst n = 1\n```", issue: "language" },
  ...[
    {
      block: {
        blockType: "table",
        columns: [{ id: "column-1", text: "列" }],
        rows: [{ id: "row-1", cells: [{ id: "cell-1", text: "值" }] }],
      },
      issue: "columns.0",
    },
    {
      block: { blockType: "faq", items: [{ id: "faq-item-1", question: "问题", answer: "回答" }] },
      issue: "items.0",
    },
    {
      block: {
        blockType: "references",
        items: [{ id: "reference-1", citationId: "source-1", label: "参考资料" }],
      },
      issue: "items.0",
    },
    {
      block: {
        blockType: "embed",
        provider: "YouTube",
        url: "https://example.test/embed",
        title: "嵌入",
        extensions: { autoplay: false },
      },
      issue: "extensions",
    },
  ].map(({ block, issue }) => ({
    name: `gf-block Payload ${block.blockType}`,
    markdown: protectedMarkdown(block),
    issue,
  })),
]

describe("COMPILE 块合同审计（未修改其他块适配）", () => {
  it.each(compilableBlocks)("OK: $name", async ({ markdown, type }) => {
    const body = markdownToBlocks(markdown)
    expect(body).toHaveLength(1)

    const compiled = await compileBody(body)

    expect(compiled).toHaveLength(1)
    expect(compiled[0]?.type).toBe(type)
  })

  it.each(rejectedBlocks)("FAIL（确认仍拒绝）: $name", async ({ markdown, issue }) => {
    const body = markdownToBlocks(markdown)
    expect(body).toHaveLength(1)

    const result = compileBody(body)

    await expect(result).rejects.toThrow("COMPILER_BLOCK_UNSUPPORTED")
    await expect(result).rejects.toThrow(issue)
  })
})

import { describe, expect, it } from "vitest"

import {
  ArticlePageSchema,
  articlePageFixture,
  RelatedPageSchema,
  StructuredDataSchema,
} from "../src/index.js"

describe("文章署名契约", () => {
  it("接受历史真人署名，当读取旧版文章时", () => {
    // Given：旧版的真人引用没有 type 或 id。
    const author = { name: "Ada Chen", url: "https://site-a.test/authors/ada" }
    const input = {
      ...articlePageFixture,
      author: { id: "author-ada", ...author },
      structuredData: [
        {
          type: "Article",
          headline: "Article",
          url: articlePageFixture.route.canonicalUrl,
          author,
        },
      ],
    }
    // When：解析旧版文档。
    const document = ArticlePageSchema.parse(input)
    // Then：真人署名未丢失。
    expect(document.author).toEqual(input.author)
    expect(document.structuredData).toEqual(input.structuredData)
  })

  it("拒绝额外署名字段，当机构引用违反严格契约时", () => {
    // Given：包含未声明字段的机构引用。
    const input = {
      type: "Article",
      headline: "Article",
      url: articlePageFixture.route.canonicalUrl,
      author: {
        type: "Organization",
        id: "#organization",
        name: "Site A",
        url: "https://site-a.test/",
        arbitrary: true,
      },
    }
    // When：解析结构化数据。
    const result = StructuredDataSchema.safeParse(input)
    // Then：strictObject 仍拒绝未知字段。
    expect(result.success).toBe(false)
  })
})

describe("列表日期契约", () => {
  const legacy = { pageId: "page-legacy", title: "Legacy", pathname: "/articles/legacy" }

  it("接受无日期列表项，当读取旧版发布产物时", () => {
    // Given：旧版列表项没有日期。
    // When：解析历史列表项。
    const item = RelatedPageSchema.parse(legacy)
    // Then：无需迁移即可读取。
    expect(item).toEqual(legacy)
  })

  it.each(["publishedAt", "modifiedAt"])("拒绝非法 %s，当日期不是时间戳时", (field) => {
    // Given：非法日期。
    const input = { ...legacy, [field]: "2026-08-17" }
    // When：解析列表项。
    const result = RelatedPageSchema.safeParse(input)
    // Then：与文章元数据相同的时间戳约束生效。
    expect(result.success).toBe(false)
  })
})

describe("文章语义字段契约", () => {
  it.each(["Article", "NewsArticle"])("接受旧版 %s，当缺少新语义字段时", (type) => {
    // Given：历史发布节点没有语言和页面主体字段。
    const input = { type, headline: "Legacy", url: "https://site-a.test/articles/legacy" }
    // When：新 schema 读取旧节点。
    const parsed = StructuredDataSchema.parse(input)
    // Then：可选字段不影响历史发布产物。
    expect(parsed).toEqual(input)
  })

  it.each([{ inLanguage: "not a locale" }, { mainEntityOfPage: "/articles/relative" }])(
    "拒绝非法语义字段，当输入不符合契约时：%j",
    (fields) => {
      // Given：语言或页面 URL 不合法。
      const input = {
        type: "Article",
        headline: "Article",
        url: "https://site-a.test/articles/article",
        ...fields,
      }
      // When：在边界解析节点。
      const result = StructuredDataSchema.safeParse(input)
      // Then：契约继续严格验证字段值。
      expect(result.success).toBe(false)
    },
  )
})

import { describe, expect, it } from "vitest"

import { ArticlePageSchema, articlePageFixture, StructuredDataSchema } from "../src/index.js"

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

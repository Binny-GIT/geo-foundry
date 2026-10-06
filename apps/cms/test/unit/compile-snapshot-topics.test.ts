import { compileSite } from "@geo/compiler"
import { describe, expect, it } from "vitest"

import { deriveListings, mapEdition } from "../../src/services/compile-snapshot-mappers"

const editionWithTopics = (primaryTopic: string, secondaryTopics: readonly string[]) =>
  mapEdition({
    assessment: { inputHash: "a".repeat(64), state: "passed" },
    canonicalDomain: "example.test",
    edition: {
      body: [{ blockType: "paragraph", text: "诺贝尔奖与神经科学研究。" }],
      createdAt: "2026-10-06T00:00:00.000Z",
      id: 42,
      primaryTopic,
      secondaryTopics,
      summary: "诺贝尔奖与神经科学研究",
      title: "诺贝尔奖研究进展",
      updatedAt: "2026-10-06T00:00:00.000Z",
    },
    media: [],
    siteKey: "site-1",
    urlPathname: "/articles/edition-42",
  })

describe("编译快照话题映射", () => {
  it("中文主话题不生成空分类", () => {
    const edition = editionWithTopics("诺贝尔奖", [])

    expect(edition?.categories).toEqual([])
  })

  it("中文次话题不生成空标签", () => {
    const edition = editionWithTopics("", ["光遗传学", "神经科学", "卡罗林斯卡学院"])

    expect(edition?.tags).toEqual([])
  })

  it("混合话题只保留有效 ASCII slug 并按 slug 去重", () => {
    const edition = editionWithTopics("Neuroscience", [
      "光遗传学",
      "Optogenetics",
      "神经科学",
      "optogenetics",
      "Brain Research",
      "Brain--Research",
    ])

    expect(edition?.categories).toEqual(["neuroscience"])
    expect(edition?.tags).toEqual(["optogenetics", "brain-research"])
  })

  it("派生列表跳过空 slug 且不生成根路径", () => {
    const topics = [{ categories: ["", "science"], tags: ["", "research"] }]

    const listings = deriveListings(topics)

    expect(listings).toEqual({
      categories: [{ id: "cat-science", pathname: "/science", slug: "science", title: "Science" }],
      tags: [
        { id: "tag-research", pathname: "/tags/research", slug: "research", title: "research" },
      ],
    })
  })

  it("派生列表也跳过规范化后为空的原始话题", () => {
    const topics = [{ categories: ["诺贝尔奖", "---"], tags: ["神经科学", "   "] }]

    const listings = deriveListings(topics)

    expect(listings).toEqual({ categories: [], tags: [] })
  })

  it("中文话题文章经过真实 compileSite 仍生成文章路由", async () => {
    const edition = editionWithTopics("诺贝尔奖", ["光遗传学", "神经科学", "卡罗林斯卡学院"])
    if (edition === null) throw new Error("测试夹具未生成文章")
    const request = {
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
        name: "中文测试站",
        organization: { name: "中文测试站" },
        seoDefaults: { description: "神经科学研究", title: "中文测试站" },
        siteId: "site-1",
        timezone: "UTC",
      },
    }

    const output = await compileSite(request)

    expect(output.routeIndex.routes).toContainEqual(
      expect.objectContaining({ pathname: "/articles/edition-42", status: "active" }),
    )
  })
})

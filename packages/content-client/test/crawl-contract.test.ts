import { describe, expect, it } from "vitest"
import { crawlCollectionSchema, crawlEntryOf, crawlRemoteJobSchema } from "../src/crawl-contract.js"

describe("crawl article_collection v1", () => {
  const article = {
    title: "示例",
    url: "https://example.test/a",
    canonical_url: "https://example.test/c",
    content: "# 新闻\n正文",
    summary: null,
    _meta: { strategy: "http" },
    extra: true,
  }
  const collection = {
    schema_version: "1.0",
    type: "article_collection",
    source_url: "https://example.test",
    requested_count: 3,
    returned_count: 1,
    status: "partial",
    items: [article],
    warnings: [],
    meta: {},
  }

  it("Given an _meta article and meta collection, when parsed, then canonical URL is mapped", () => {
    const parsed = crawlCollectionSchema.parse(collection)
    expect(crawlEntryOf(parsed.items[0] ?? article).sourceUrl).toBe("https://example.test/c")
  })
  it("Given absent canonical URL, when mapped, then source URL falls back to url", () => {
    expect(crawlEntryOf({ ...article, canonical_url: null }).sourceUrl).toBe(article.url)
  })
  it("Given an object error on a failed job, when parsed, then it remains readable", () => {
    const job = crawlRemoteJobSchema.parse({
      id: "job_1234567890abcdef",
      status: "failed",
      error: { code: "FETCH_FAILED" },
    })
    expect(job.error).toEqual({ code: "FETCH_FAILED" })
  })
})

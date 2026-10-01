import { describe, expect, it } from "vitest"

import { crawlIntakeFieldsOf } from "../../src/server/repositories/crawl-ingest"

describe("crawl 单篇结果转稿源字段", () => {
  const entry = {
    content: "## 小标题\n\n北欧分级诊疗的核心是全科首诊。\r\n",
    sourceUrl: "https://Example.test/a?utm_source=x",
    summary: null,
    title: "文章",
  }

  it("Given 合法 Markdown 与 https 地址, when 转换, then 得到区块、规范化地址与内容哈希", () => {
    const fields = crawlIntakeFieldsOf(entry)

    expect(fields?.blocks.length).toBeGreaterThan(0)
    expect(fields?.normalizedUrl).toMatch(/^https:\/\/example\.test\/a/)
    expect(fields?.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("Given 只有空白的正文, when 转换, then 跳过这一篇而不是让整批失败", () => {
    expect(crawlIntakeFieldsOf({ ...entry, content: " \n\t " })).toBeNull()
  })

  it("Given 非 http(s) 来源地址, when 转换, then 跳过这一篇", () => {
    expect(crawlIntakeFieldsOf({ ...entry, sourceUrl: "mailto:editor@example.test" })).toBeNull()
  })

  it("Given 相同正文只差换行风格, when 转换, then 内容哈希一致以便跨任务去重", () => {
    const unix = crawlIntakeFieldsOf({ ...entry, content: "正文第一段\n\n正文第二段" })
    const windows = crawlIntakeFieldsOf({ ...entry, content: "正文第一段\r\n\r\n正文第二段" })

    expect(unix?.contentHash).toBe(windows?.contentHash)
  })
})

import { describe, expect, it } from "vitest"

import { normalizeEditionBodyWrite } from "../../src/editor/normalize-edition-body"

describe("edition body write normalization", () => {
  it("treats Markdown as authoritative when both forms are supplied", () => {
    const data: Record<string, unknown> = {
      body: [{ blockType: "paragraph", text: "冲突的旧 blocks" }],
      bodyMarkdown: "## 新标题\n\n权威正文。",
    }
    expect(normalizeEditionBodyWrite(data)).toEqual({
      body: [
        { blockType: "heading", level: "2", text: "新标题" },
        { blockType: "paragraph", text: "权威正文。" },
      ],
      bodyMarkdown: "## 新标题\n\n权威正文。",
    })
  })

  it("backfills Markdown for a legacy body-only write", () => {
    const data: Record<string, unknown> = {
      body: [
        { blockType: "paragraph", text: "生成链路写入的正文。" },
        { blockType: "code", caption: null, code: "npm test", language: "bash" },
      ],
      summary: "生成摘要",
    }
    const normalized = normalizeEditionBodyWrite(data)
    expect(normalized["bodyMarkdown"]).toBe("生成链路写入的正文。\n\n```bash\nnpm test\n```")
    expect(normalized["body"]).toEqual(data["body"])
  })

  it("does not let a merged stale Markdown field overwrite changed legacy blocks", () => {
    const original = {
      body: [{ blockType: "paragraph", text: "旧正文" }],
      bodyMarkdown: "旧正文",
      title: "标题",
    }
    // Payload beforeChange.data 是与 original 合并后的完整文档：本次请求只改 body，
    // 但旧 bodyMarkdown 仍会出现在 data 里。
    const data: Record<string, unknown> = {
      ...original,
      body: [
        { blockType: "heading", level: "2", text: "新标题" },
        { blockType: "paragraph", text: "新正文" },
      ],
    }
    const normalized = normalizeEditionBodyWrite(data, original)
    expect(normalized["bodyMarkdown"]).toBe("## 新标题\n\n新正文")
    expect(normalized["body"]).toEqual(data["body"])
  })

  it("does not touch the body for a metadata-only write", () => {
    const original = {
      body: [{ blockType: "paragraph", text: "正文" }],
      bodyMarkdown: "正文",
      owner: null,
      priority: "normal",
    }
    const data = { ...original, owner: 1116, priority: "high" }
    expect(normalizeEditionBodyWrite(data, original)).toEqual(data)
    expect(data["bodyMarkdown"]).toBe("正文")
    expect(data["body"]).toEqual(original.body)
  })

  it("preserves unknown legacy blocks through a protected Markdown segment", () => {
    const unknown = { blockType: "future-widget", nested: { items: [1, 2] } }
    const data: Record<string, unknown> = { body: [unknown] }
    const normalized = normalizeEditionBodyWrite(data)
    expect(normalized["bodyMarkdown"]).toContain(":::gf-block")
    expect(normalized["bodyMarkdown"]).toContain('"blockType":"future-widget"')
  })
})

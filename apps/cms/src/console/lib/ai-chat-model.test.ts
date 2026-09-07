import { describe, expect, it } from "vitest"

import { blocksOf, splitArticle } from "./ai-chat-model"

describe("AI chat reply model", () => {
  it("Given a plain answer, when splitting, then it stays a single message with no article", () => {
    expect(splitArticle("HTTP 标头是请求或响应中的元数据键值对。")).toEqual({
      article: null,
      message: "HTTP 标头是请求或响应中的元数据键值对。",
    })
  })

  it("Given a reply with an article fence, when splitting, then prose and fenced article separate", () => {
    const reply = "已按三段引言改写。\n\n```article\n## 标题\n\n第一段。\n\n第二段。\n```"
    const parsed = splitArticle(reply)
    expect(parsed.message).toBe("已按三段引言改写。")
    expect(parsed.article).toContain("## 标题")
    expect(parsed.article).toContain("第一段。")
  })

  it("Given a fence-only reply, when splitting, then the message falls back to stock copy", () => {
    const parsed = splitArticle("```article\n正文。\n```")
    expect(parsed.article).toBe("正文。")
    expect(parsed.message).toBe("已根据你的要求准备好正文。")
  })

  it("Given an unterminated fence, when splitting, then nothing is treated as an article", () => {
    const reply = "我写了一半：\n\n```article\n只有开头没有结尾"
    expect(splitArticle(reply)).toEqual({ article: null, message: reply })
  })

  it("Given prose with headings and paragraphs, when inserting as blocks, then headings map to heading rows", () => {
    const blocks = blocksOf("## 引言\n\n这是第一段。\n\n这是第二段。")
    expect(blocks).toEqual([
      { blockType: "heading", level: "2", text: "引言" },
      { blockType: "paragraph", text: "这是第一段。" },
      { blockType: "paragraph", text: "这是第二段。" },
    ])
  })

  it("Given blank-only prose, when inserting as blocks, then nothing is produced", () => {
    expect(blocksOf("  \n\n  \n")).toEqual([])
  })
})

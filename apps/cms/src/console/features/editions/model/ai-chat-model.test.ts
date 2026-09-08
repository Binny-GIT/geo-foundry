import { describe, expect, it } from "vitest"

import {
  applyProposal,
  buildDraftContext,
  DRAFT_MARKDOWN_LIMIT,
  selectionRewritePrompt,
  splitArticle,
} from "./ai-chat-model"

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

  it("Given an article containing fenced code blocks, when splitting, then the proposal keeps the code intact", () => {
    const reply =
      "已改写。\n\n```article\n## 示例\n\n安装命令：\n\n```bash\nnpm install\n```\n\n结束段落。\n```"
    const parsed = splitArticle(reply)
    expect(parsed.message).toBe("已改写。")
    expect(parsed.article).toContain("```bash\nnpm install\n```")
    expect(parsed.article).toContain("结束段落。")
  })
})

describe("AI chat draft context", () => {
  it("Given editor values, when building the context, then they pass through verbatim within limits", () => {
    expect(
      buildDraftContext({ markdown: "# 正文", summary: "摘要", title: "标题" }),
    ).toEqual({ markdown: "# 正文", summary: "摘要", title: "标题" })
  })

  it("Given oversized values, when building the context, then each field is truncated, not rejected", () => {
    const context = buildDraftContext({
      markdown: "字".repeat(DRAFT_MARKDOWN_LIMIT + 100),
      summary: "摘".repeat(900),
      title: "题".repeat(300),
    })
    expect(context.markdown.length).toBe(DRAFT_MARKDOWN_LIMIT)
    expect(context.summary.length).toBe(600)
    expect(context.title.length).toBe(200)
  })
})

describe("AI chat proposal application", () => {
  const markdown = "第一段。\n\n第二段。\n\n第三段。"

  it("Given a replace proposal, when applying, then the article becomes the whole body", () => {
    expect(applyProposal(markdown, "全新正文。", "replace")).toBe("全新正文。")
  })

  it("Given an append proposal over an empty body, when applying, then the article stands alone", () => {
    expect(applyProposal("", "开头。", "append")).toBe("开头。")
  })

  it("Given an append proposal, when applying, then it lands after a blank line", () => {
    expect(applyProposal(markdown, "第四段。", "append")).toBe(
      "第一段。\n\n第二段。\n\n第三段。\n\n第四段。",
    )
  })

  it("Given a selection proposal, when applying, then only the selected span is swapped", () => {
    const start = markdown.indexOf("第二段")
    const selection = { end: start + "第二段。".length, start, text: "第二段。" }
    expect(applyProposal(markdown, "改写后的第二段。", "selection", selection)).toBe(
      "第一段。\n\n改写后的第二段。\n\n第三段。",
    )
  })

  it("Given a drifted body, when applying a selection proposal, then it refuses with null", () => {
    const selection = { end: 12, start: 9, text: "旧选区" }
    // 正文已改：选区定位处不再是快照里的文字。
    expect(applyProposal("完全不同的正文。", "改写。", "selection", selection)).toBeNull()
  })

  it("Given a missing or collapsed selection, when applying, then it refuses with null", () => {
    expect(applyProposal(markdown, "改写。", "selection")).toBeNull()
    expect(
      applyProposal(markdown, "改写。", "selection", { end: 5, start: 5, text: "" }),
    ).toBeNull()
  })
})

describe("AI chat shortcut prompts", () => {
  it("Given a selection, when templating the rewrite prompt, then the text is embedded with delimiters", () => {
    const prompt = selectionRewritePrompt("要改写的一段。")
    expect(prompt).toContain("<<<选中内容开始>>>")
    expect(prompt).toContain("<<<选中内容结束>>>")
    expect(prompt).toContain("要改写的一段。")
    expect(prompt).toContain("```article")
  })

  it("Given an oversized selection, when templating, then the quoted text is capped", () => {
    const prompt = selectionRewritePrompt("长".repeat(5000))
    const quoted = prompt.split("<<<选中内容开始>>>\n")[1]?.split("\n<<<选中内容结束>>>")[0] ?? ""
    expect(quoted.length).toBe(2000)
  })
})

import { describe, expect, it, vi } from "vitest"

vi.mock("../../src/config/credentials", () => ({
  optionalCmsCredential: (
    environment: Record<string, string | undefined>,
    key: string,
  ): string | undefined => {
    const value = environment[key]
    if (value === "UNREADABLE") throw new Error("credential file unreadable")
    return value === undefined ? undefined : value
  },
}))

import {
  outlineOf,
  providerConfigOf,
  systemPromptOf,
} from "../../src/services/edition-ai-chat-model"

describe("AI chat provider config", () => {
  it("Given no explicit provider switch, when resolving, then the assistant stays unconfigured", () => {
    expect(
      providerConfigOf({ AI_API_KEY: "k", AI_BASE_URL: "https://api", AI_CHAT_MODEL: "m" }),
    ).toBeNull()
  })

  it("Given a complete provider environment, when resolving, then trailing slashes are trimmed and defaults applied", () => {
    expect(
      providerConfigOf({
        AI_API_KEY: "k",
        AI_BASE_URL: "https://api.xllent.dev/v1/",
        AI_CHAT_MODEL: "gpt-test",
        AI_PROVIDER: "openai-compatible",
      }),
    ).toEqual({
      apiKey: "k",
      baseUrl: "https://api.xllent.dev/v1",
      maxTokens: 8192,
      model: "gpt-test",
      timeoutMs: 60_000,
    })
  })

  it("Given a custom bounded timeout and token budget, when resolving, then both are honored", () => {
    const config = providerConfigOf({
      AI_API_KEY: "k",
      AI_BASE_URL: "https://api",
      AI_CHAT_MODEL: "m",
      AI_MAX_TOKENS: "16384",
      AI_PROVIDER: "openai-compatible",
      AI_TIMEOUT_MS: "120000",
    })
    expect(config?.timeoutMs).toBe(120_000)
    expect(config?.maxTokens).toBe(16_384)
  })

  it("Given an out-of-range token budget, when resolving, then it falls back to the long-article default", () => {
    expect(
      providerConfigOf({
        AI_API_KEY: "k",
        AI_BASE_URL: "https://api",
        AI_CHAT_MODEL: "m",
        AI_MAX_TOKENS: "999999",
        AI_PROVIDER: "openai-compatible",
      })?.maxTokens,
    ).toBe(8192)
  })

  it("Given an unreadable key file, when resolving, then it reads as unconfigured, not a fault", () => {
    expect(
      providerConfigOf({
        AI_API_KEY: "UNREADABLE",
        AI_BASE_URL: "https://api",
        AI_CHAT_MODEL: "m",
        AI_PROVIDER: "openai-compatible",
      }),
    ).toBeNull()
  })

  it("Given a missing key, when resolving, then it refuses instead of calling with an empty credential", () => {
    expect(
      providerConfigOf({
        AI_BASE_URL: "https://api",
        AI_CHAT_MODEL: "m",
        AI_PROVIDER: "openai-compatible",
      }),
    ).toBeNull()
  })
})

describe("AI chat prompt model", () => {
  it("Given an unsaved draft without content, when building the system prompt, then it stays a plain writing helper", () => {
    const prompt = systemPromptOf(null)
    expect(prompt).toContain("尚未保存的新稿件")
    expect(prompt).toContain("（正文为空）")
  })

  it("Given an unsaved draft with local content, when building the system prompt, then the unsaved text is injected", () => {
    const prompt = systemPromptOf(null, {
      markdown: "已经写了开头但没有保存。",
      summary: "本地摘要",
      title: "本地标题",
    })
    expect(prompt).toContain("已经写了开头但没有保存。")
    expect(prompt).toContain("标题：本地标题")
    expect(prompt).toContain("摘要：本地摘要")
  })

  it("Given a saved edition, when building the system prompt, then metadata and stored markdown are injected", () => {
    const prompt = systemPromptOf({
      angle: "入门教程",
      body: [
        { blockType: "heading", text: "什么是 HTTP" },
        { blockType: "paragraph", text: "标头是键值对。" },
        { blockType: "image", src: "/media/x.png" },
      ],
      bodyMarkdown: "## 什么是 HTTP\n\n标头是键值对。",
      primaryTopic: "HTTP",
      summary: "一篇关于 HTTP 标头的文章。",
      title: "HTTP 标头",
    })
    expect(prompt).toContain("标题：HTTP 标头")
    expect(prompt).toContain("摘要：一篇关于 HTTP 标头的文章。")
    // 已保存的 Markdown 全文直接注入，而不是旧的大纲截断。
    expect(prompt).toContain("## 什么是 HTTP")
    expect(prompt).not.toContain("[image]")
  })

  it("Given an unsaved snapshot, when building the system prompt, then it wins over the stored copy", () => {
    const prompt = systemPromptOf(
      {
        body: [{ blockType: "paragraph", text: "数据库里的旧段落。" }],
        bodyMarkdown: "数据库里的旧正文。",
        summary: "旧摘要",
        title: "旧标题",
      },
      { markdown: "编辑器里未保存的新正文。", summary: "新摘要", title: "新标题" },
    )
    expect(prompt).toContain("编辑器里未保存的新正文。")
    expect(prompt).toContain("标题：新标题")
    expect(prompt).not.toContain("数据库里的旧正文。")
    expect(prompt).not.toContain("旧标题")
  })

  it("Given a legacy edition without bodyMarkdown, when building the system prompt, then the block outline is the fallback", () => {
    const prompt = systemPromptOf({
      body: [
        { blockType: "heading", text: "标题一" },
        { blockType: "paragraph", text: "段落。" },
      ],
      primaryTopic: "",
      summary: "",
      title: "旧文",
    })
    expect(prompt).toContain("## 标题一")
    expect(prompt).toContain("段落。")
  })

  it("Given an oversized body, when building the system prompt, then it is truncated with a note", () => {
    const prompt = systemPromptOf(null, { markdown: "长".repeat(20000) })
    expect(prompt).toContain("已截断")
    expect(prompt.length).toBeLessThan(20000)
  })

  it("Given a long body, when outlining, then only the first 40 blocks are kept within 8000 chars", () => {
    const blocks = Array.from({ length: 60 }, (_, index) => ({
      blockType: "paragraph",
      text: `第 ${String(index)} 段内容`,
    }))
    const outline = outlineOf(blocks)
    expect(outline).toContain("第 39 段内容")
    expect(outline).not.toContain("第 40 段内容")
    expect(outline).not.toContain("第 59 段内容")
    expect(outline.length).toBeLessThanOrEqual(8000)
  })
})

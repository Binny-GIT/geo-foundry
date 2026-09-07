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

import { outlineOf, providerConfigOf, systemPromptOf } from "../../src/services/edition-ai-chat-model"

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
      model: "gpt-test",
      timeoutMs: 60_000,
    })
  })

  it("Given a custom bounded timeout, when resolving, then it is honored", () => {
    const config = providerConfigOf({
      AI_API_KEY: "k",
      AI_BASE_URL: "https://api",
      AI_CHAT_MODEL: "m",
      AI_PROVIDER: "openai-compatible",
      AI_TIMEOUT_MS: "120000",
    })
    expect(config?.timeoutMs).toBe(120_000)
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
  it("Given an unsaved draft, when building the system prompt, then it stays a plain writing helper", () => {
    const prompt = systemPromptOf(null)
    expect(prompt).toContain("尚未保存的新稿件")
    expect(prompt).not.toContain("当前稿件信息")
  })

  it("Given a saved edition, when building the system prompt, then metadata and outline are injected", () => {
    const prompt = systemPromptOf({
      angle: "入门教程",
      body: [
        { blockType: "heading", text: "什么是 HTTP" },
        { blockType: "paragraph", text: "标头是键值对。" },
        { blockType: "image", src: "/media/x.png" },
      ],
      primaryTopic: "HTTP",
      summary: "一篇关于 HTTP 标头的文章。",
      title: "HTTP 标头",
    })
    expect(prompt).toContain("标题：HTTP 标头")
    expect(prompt).toContain("摘要：一篇关于 HTTP 标头的文章。")
    expect(prompt).toContain("## 什么是 HTTP")
    expect(prompt).toContain("标头是键值对。")
    // 无文字的区块以占位形式进入大纲，模型仍能感知结构。
    expect(prompt).toContain("[image]")
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

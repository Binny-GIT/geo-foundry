import { describe, expect, it } from "vitest"

import { createWorkerAiProvider } from "../../src/config/ai-provider.js"

describe("Worker AI provider selection", () => {
  it("uses the deterministic Fake Provider by default", () => {
    expect(createWorkerAiProvider({}, () => "unused").providerId).toBe("fake")
    expect(createWorkerAiProvider({ AI_PROVIDER: "fake" }, () => "unused").providerId).toBe("fake")
  })

  it("requires an explicit valid provider mode", () => {
    expect(() => createWorkerAiProvider({ AI_PROVIDER: "unknown" }, () => "unused")).toThrow(
      "WORKER_AI_PROVIDER_INVALID",
    )
  })

  it("fails closed when the configured OpenAI-compatible Provider lacks a key", () => {
    expect(() =>
      createWorkerAiProvider(
        {
          AI_BASE_URL: "https://provider.test/v1",
          AI_CHAT_MODEL: "chat",
          AI_EMBEDDING_MODEL: "embed",
          AI_PROVIDER: "openai-compatible",
        },
        () => "unset",
      ),
    ).toThrow("WORKER_AI_API_KEY_REQUIRED")
  })

  it("constructs the configured OpenAI-compatible Provider from owner-managed credentials", () => {
    const provider = createWorkerAiProvider(
      {
        AI_BASE_URL: "https://provider.test/v1",
        AI_CHAT_MODEL: "chat",
        AI_EMBEDDING_MODEL: "embed",
        AI_PROVIDER: "openai-compatible",
      },
      (name) => (name === "AI_API_KEY" ? "owner-only-key" : "unset"),
    )
    expect(provider.providerId).toBe("openai-compatible")
    expect(provider.chatModelId).toBe("chat")
    expect(provider.embeddingModelId).toBe("embed")
  })
})

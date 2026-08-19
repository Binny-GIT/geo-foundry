import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { ContentClientError } from "@geo/content-client"
import type { SimilarityMatch } from "@geo/content-client"
import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  serializeSemanticThresholds,
  type SemanticThresholds,
} from "@geo/quality-rules"

import { ProviderError } from "../../src/providers/errors.js"
import { createFakeProvider } from "../../src/providers/fake.js"
import {
  SEMANTIC_CANDIDATE_LIMIT,
  runSemanticCheck,
  semanticThresholdsHash,
} from "../../src/embeddings/semantic-check.js"

type StoredEmbedding = {
  dimension: number
  inputHash: string
  modelId: string
  scope: "content" | "title"
  vector: readonly number[]
}

const match = (overrides: Partial<SimilarityMatch> = {}): SimilarityMatch => ({
  editionId: 30,
  inputHash: "b".repeat(64),
  siteId: 3,
  similarity: 0.5,
  title: "Candidate",
  ...overrides,
})

const depsWith = (
  matches: () => {
    readonly crossDomainContent: readonly SimilarityMatch[]
    readonly sameSiteContent: readonly SimilarityMatch[]
    readonly sameSiteTitle: readonly SimilarityMatch[]
  },
) => {
  const stored: StoredEmbedding[] = []
  const client = {
    findSimilarEditions: vi.fn(
      async (
        _editionId: number,
        request: {
          comparison: string
          dimension?: number
          limit?: number
          modelId?: string
          scope: string
        },
      ) => {
        if (request.comparison === "cross-domain") {
          return matches().crossDomainContent
        }
        return request.scope === "title" ? matches().sameSiteTitle : matches().sameSiteContent
      },
    ),
    storeEmbedding: vi.fn(async (_editionId: number, request: StoredEmbedding) => {
      stored.push(request)
      return { created: true, embeddingId: stored.length, embeddingKey: `key-${stored.length}` }
    }),
  }
  return { client, stored }
}

const input = {
  content: "A deterministic body about release pipelines.",
  editionId: 12,
  requestId: "req-semantic-1",
  title: "Deterministic releases",
}

describe("runSemanticCheck", () => {
  it("embeds title and content, stores both scopes, and passes on distant matches", async () => {
    const { client, stored } = depsWith(() => ({
      crossDomainContent: [match({ similarity: 0.4 })],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    const result = await runSemanticCheck(
      { client, provider: createFakeProvider({ dimension: 32 }) },
      input,
    )
    expect(result.kind).toBe("assessed")
    if (result.kind !== "assessed") {
      return
    }
    expect(result.decision.outcome).toBe("pass")
    expect(result.providerId).toBe("fake")
    expect(result.embeddingModelId).toBe("fake-embedding-v1")
    expect(stored.map((entry) => entry.scope).sort()).toEqual(["content", "title"])
    expect(stored[0]?.dimension).toBe(32)
    expect(result.inputHashes.title).toMatch(/^[0-9a-f]{64}$/)
    expect(result.inputHashes.content).not.toBe(result.inputHashes.title)
    const titleEntry = stored.find((entry) => entry.scope === "title")
    expect(titleEntry?.inputHash).toBe(result.inputHashes.title)
    expect(client.storeEmbedding).toHaveBeenCalledTimes(2)
    expect(client.findSimilarEditions).toHaveBeenCalledTimes(3)
    expect(result.thresholdsHash).toBe(
      createHash("sha256")
        .update(serializeSemanticThresholds(DEFAULT_SEMANTIC_THRESHOLDS))
        .digest("hex"),
    )
  })

  it("applies the persisted threshold snapshot from the caller", async () => {
    const thresholds: SemanticThresholds = {
      ...DEFAULT_SEMANTIC_THRESHOLDS,
      crossDomainReview: 0.5,
    }
    const { client } = depsWith(() => ({
      crossDomainContent: [match({ similarity: 0.6 })],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    const result = await runSemanticCheck(
      { client, provider: createFakeProvider() },
      { ...input, thresholds },
    )
    expect(result.kind).toBe("assessed")
    if (result.kind === "assessed") {
      expect(result.decision.outcome).toBe("review-required")
      expect(result.thresholdsHash).toBe(semanticThresholdsHash(thresholds))
    }
  })

  it("maps provider timeouts to a retryable error outcome", async () => {
    const { client } = depsWith(() => ({
      crossDomainContent: [],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    const provider = {
      ...createFakeProvider(),
      embed: () => {
        throw new ProviderError("PROVIDER_TIMEOUT", "retryable", "deadline exceeded")
      },
    }
    const result = await runSemanticCheck({ client, provider }, input)
    expect(result).toEqual({
      code: "PROVIDER_TIMEOUT",
      detail: "deadline exceeded",
      kind: "error",
      retryability: "retryable",
      thresholdsHash: semanticThresholdsHash(DEFAULT_SEMANTIC_THRESHOLDS),
    })
    expect(client.storeEmbedding).not.toHaveBeenCalled()
  })

  it("fails closed when the store rejects the vector", async () => {
    const { client } = depsWith(() => ({
      crossDomainContent: [],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    client.storeEmbedding.mockRejectedValue(
      new ContentClientError("EMBEDDING_DIMENSION_MISMATCH", 400, "req-1"),
    )
    const result = await runSemanticCheck({ client, provider: createFakeProvider() }, input)
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.code).toBe("EMBEDDING_DIMENSION_MISMATCH")
      expect(result.retryability).toBeUndefined()
    }
    expect(client.findSimilarEditions).not.toHaveBeenCalled()
  })

  it("rejects empty embedding inputs before any provider call", async () => {
    const { client } = depsWith(() => ({
      crossDomainContent: [],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    const provider = { ...createFakeProvider(), embed: vi.fn() }
    const result = await runSemanticCheck({ client, provider }, { ...input, title: "" })
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.code).toBe("SEMANTIC_INPUT_INVALID")
      expect(result.retryability).toBe("terminal")
    }
    expect(provider.embed).not.toHaveBeenCalled()
  })

  it("queries with the shared candidate limit and provider dimension", async () => {
    const { client } = depsWith(() => ({
      crossDomainContent: [],
      sameSiteContent: [],
      sameSiteTitle: [],
    }))
    await runSemanticCheck({ client, provider: createFakeProvider({ dimension: 16 }) }, input)
    for (const call of client.findSimilarEditions.mock.calls) {
      expect(call[1]?.limit).toBe(SEMANTIC_CANDIDATE_LIMIT)
      expect(call[1]?.dimension).toBe(16)
      expect(call[1]?.modelId).toBe("fake-embedding-v1")
    }
  })
})

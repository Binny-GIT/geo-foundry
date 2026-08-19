import { describe, expect, it, vi } from "vitest"

import { ContentClientError, ContentServiceClient } from "../src/client.js"

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type CapturedRequest = {
  body: string | null
  headers: Record<string, string>
  method: string
  url: string
}

const fakeFetch = (response: { body?: unknown; status?: number }, capture: CapturedRequest[]) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value
    })
    capture.push({
      body: init?.body === null || init?.body === undefined ? null : String(init.body),
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    })
    return new Response(JSON.stringify(response.body ?? {}), {
      headers: { "x-request-id": "srv-req-1" },
      status: response.status ?? 200,
    })
  })

const client = (fetchMock: ReturnType<typeof fakeFetch>) =>
  new ContentServiceClient({
    apiKey: "service-api-key",
    baseUrl: "http://cms.test",
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  })

describe("content service client", () => {
  it("sends the service api key, request ids, and validates successful responses", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch(
        {
          body: {
            fields: ["title"],
            inputHash: SHA,
            workflowRevision: 0,
            workflowStatus: "draft",
          },
        },
        captured,
      ),
    )
    const receipt = await instance.writeDraftVersion(
      12,
      { title: "Generated" },
      { operationId: "op-0001", requestId: "req-0001-abcd" },
    )
    expect(receipt.workflowStatus).toBe("draft")
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe("http://cms.test/api/internal/editions/12/versions")
    expect(captured[0]?.method).toBe("POST")
    expect(captured[0]?.headers.authorization).toBe("service-api-key")
    expect(captured[0]?.headers["x-request-id"]).toBe("req-0001-abcd")
    expect(captured[0]?.headers["x-operation-id"]).toBe("op-0001")
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({ title: "Generated" })
  })

  it("rejects locally invalid requests without any network call", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(fakeFetch({}, captured))
    await expect(instance.writeDraftVersion(12, {})).rejects.toThrow(ContentClientError)
    expect(captured).toHaveLength(0)
  })

  it("maps server error envelopes to typed errors with request correlation", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch(
        {
          body: { error: { code: "EDITION_WORKFLOW_TENANT_MISMATCH", requestId: "srv-req-9" } },
          status: 403,
        },
        captured,
      ),
    )
    const failure = await instance.requestPublish(12).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ContentClientError)
    expect((failure as ContentClientError).code).toBe("EDITION_WORKFLOW_TENANT_MISMATCH")
    expect((failure as ContentClientError).status).toBe(403)
    expect((failure as ContentClientError).requestId).toBe("srv-req-9")
  })

  it("fails closed on schema-mismatched success payloads", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(fakeFetch({ body: { unexpected: true } }, captured))
    const failure = await instance.requestPublish(12).catch((error: unknown) => error)
    expect((failure as ContentClientError).code).toBe("CLIENT_RESPONSE_SCHEMA_MISMATCH")
  })
})

describe("content service client: embeddings", () => {
  const vector = [0.25, -0.5, 1]

  it("stores an edition embedding and returns the receipt", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch({ body: { created: true, embeddingId: 7, embeddingKey: "emb-0001" } }, captured),
    )
    const receipt = await instance.storeEmbedding(
      12,
      { dimension: 3, inputHash: SHA, modelId: "fake-embedding-v1", scope: "content", vector },
      { operationId: "op-0002", requestId: "req-0002-abcd" },
    )
    expect(receipt).toEqual({ created: true, embeddingId: 7, embeddingKey: "emb-0001" })
    expect(captured[0]?.url).toBe("http://cms.test/api/internal/editions/12/embeddings")
    expect(captured[0]?.headers["x-operation-id"]).toBe("op-0002")
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      dimension: 3,
      inputHash: SHA,
      modelId: "fake-embedding-v1",
      scope: "content",
      vector,
    })
  })

  it("replays an identical store request against the same key", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch({ body: { created: false, embeddingId: 7, embeddingKey: "emb-0001" } }, captured),
    )
    const receipt = await instance.storeEmbedding(12, {
      dimension: 3,
      inputHash: SHA,
      modelId: "fake-embedding-v1",
      scope: "content",
      vector,
    })
    expect(receipt.created).toBe(false)
  })

  it("queries similar editions and validates the match list", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch(
        {
          body: {
            matches: [
              {
                editionId: 30,
                inputHash: SHA,
                siteId: 3,
                similarity: 0.931,
                title: "Near duplicate",
              },
            ],
          },
        },
        captured,
      ),
    )
    const matches = await instance.findSimilarEditions(12, {
      comparison: "cross-domain",
      dimension: 3,
      limit: 5,
      modelId: "fake-embedding-v1",
      scope: "content",
      vector,
    })
    expect(matches).toEqual([
      { editionId: 30, inputHash: SHA, siteId: 3, similarity: 0.931, title: "Near duplicate" },
    ])
    expect(captured[0]?.url).toBe("http://cms.test/api/internal/editions/12/similarity")
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      comparison: "cross-domain",
      dimension: 3,
      limit: 5,
      modelId: "fake-embedding-v1",
      scope: "content",
      vector,
    })
  })

  it("rejects an empty vector locally", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(fakeFetch({}, captured))
    await expect(
      instance.storeEmbedding(12, {
        dimension: 3,
        inputHash: SHA,
        modelId: "fake-embedding-v1",
        scope: "title",
        vector: [],
      }),
    ).rejects.toThrow(ContentClientError)
    expect(captured).toHaveLength(0)
  })

  it("maps dimension-mismatch error envelopes to typed errors", async () => {
    const captured: CapturedRequest[] = []
    const instance = client(
      fakeFetch(
        {
          body: { error: { code: "EMBEDDING_DIMENSION_MISMATCH", requestId: "srv-req-4" } },
          status: 400,
        },
        captured,
      ),
    )
    const failure = await instance
      .storeEmbedding(12, {
        dimension: 3,
        inputHash: SHA,
        modelId: "fake-embedding-v1",
        scope: "content",
        vector,
      })
      .catch((error: unknown) => error)
    expect((failure as ContentClientError).code).toBe("EMBEDDING_DIMENSION_MISMATCH")
    expect((failure as ContentClientError).status).toBe(400)
  })
})

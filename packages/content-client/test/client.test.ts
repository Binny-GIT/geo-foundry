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

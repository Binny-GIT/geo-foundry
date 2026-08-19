import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ContentClientError, type OperationSnapshot } from "@geo/content-client"

import { createContentServiceServer } from "../../src/http/server.js"

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const operationOf = (operationId: string): OperationSnapshot => ({
  attempt: 1,
  currentStage: null,
  endpoint: "/v1/generate",
  error: null,
  operationId,
  operationType: "generate",
  result: null,
  state: "queued",
  tenantId: 7,
})

const generateBody = {
  brief: {
    intent: "Explain deterministic gates for two sites",
    sources: [{ id: "src-1", snippet: "Gates run before release.", title: "PRD" }],
    topic: "Deterministic content gates",
  },
  contentId: 12,
  targets: [
    {
      angle: "practitioner-playbook",
      editionId: 101,
      siteStrategy: { locale: "en-US", name: "Site A" },
    },
  ],
}

type Captured = { body: string | null; headers: Record<string, string>; status: number }

const post = async (
  base: string,
  path: string,
  body: unknown,
  key: string | null,
  apiKey = "test-key",
): Promise<Captured> => {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }),
      ...(key === null ? {} : { "idempotency-key": key }),
    },
    method: "POST",
  })
  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  }
}

describe("content-service HTTP API contract", () => {
  let base: string
  let server: ReturnType<typeof createContentServiceServer>
  let created: OperationSnapshot[]
  let submissions: number
  const operations = new Map<string, OperationSnapshot>()

  beforeAll(async () => {
    created = []
    submissions = 0
    server = createContentServiceServer({
      apiKey: "test-key",
      client: {
        async getOperation(operationId: string) {
          const operation = operations.get(operationId)
          if (operation === undefined) {
            throw new ContentClientError("OPERATION_NOT_FOUND", 404, null)
          }
          return operation
        },
        async submitOperation(request) {
          submissions += 1
          const identity = `${request.endpoint}:${request.idempotencyKey}`
          const previous = operations.get(identity)
          if (previous !== undefined) {
            const previousHash = JSON.stringify((previous.result ?? {}).requestHash ?? null)
            const currentHash = JSON.stringify(
              (request.requestPayload as { requestHash?: string }).requestHash ?? null,
            )
            if (previousHash !== currentHash) {
              throw new ContentClientError("IDEMPOTENCY_KEY_REUSED", 409, "srv-1")
            }
            return { created: false, operation: previous }
          }
          const operation: OperationSnapshot = {
            ...operationOf(`op-${submissions}`),
            endpoint: request.endpoint,
            operationType: request.operationType,
            result: {
              requestHash: (request.requestPayload as { requestHash?: string }).requestHash,
            },
          }
          operations.set(identity, operation)
          operations.set(operation.operationId, operation)
          return { created: true, operation }
        },
      },
      host: "127.0.0.1",
      maxBodyBytes: 8192,
      onOperationCreated: async (operation) => {
        created.push(operation)
      },
      port: 0,
    })
    base = await server.listen()
  })

  afterAll(async () => {
    await server.close()
  })

  it("accepts a generate request with 202, operation URL, and executor dispatch", async () => {
    const response = await post(base, "/v1/generate", generateBody, "key-0001-abcd")
    expect(response.status).toBe(202)
    expect(response.headers.location).toMatch(/^\/v1\/operations\/op-\d+$/)
    expect(response.headers["x-request-id"]).toBeTruthy()
    const body = JSON.parse(response.body ?? "{}") as { operation: OperationSnapshot }
    expect(body.operation.state).toBe("queued")
    expect(body.operation.operationType).toBe("generate")
    expect(created).toHaveLength(1)
  })

  it("returns the original operation for an exact replay", async () => {
    const replay = await post(base, "/v1/generate", generateBody, "key-0001-abcd")
    expect(replay.status).toBe(200)
    const first = await post(base, "/v1/generate", generateBody, "key-replay-1")
    const second = await post(base, "/v1/generate", generateBody, "key-replay-1")
    expect(second.status).toBe(200)
    expect(
      (JSON.parse(second.body ?? "{}") as { operation: OperationSnapshot }).operation.operationId,
    ).toBe(
      (JSON.parse(first.body ?? "{}") as { operation: OperationSnapshot }).operation.operationId,
    )
    expect(created).toHaveLength(2)
  })

  it("rejects key reuse with a different body via 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const conflict = await post(
      base,
      "/v1/generate",
      { ...generateBody, contentId: 13 },
      "key-0001-abcd",
    )
    expect(conflict.status).toBe(409)
    expect(JSON.parse(conflict.body ?? "{}").error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  it("requires the Idempotency-Key header on mutating endpoints", async () => {
    const response = await post(base, "/v1/generate", generateBody, null)
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body ?? "{}").error.code).toBe(
      "CONTENT_SERVICE_IDEMPOTENCY_KEY_REQUIRED",
    )
  })

  it("rejects unauthorized callers before touching the ledger", async () => {
    const response = await post(base, "/v1/generate", generateBody, "key-0002-abcd", "wrong")
    expect(response.status).toBe(401)
    expect(JSON.parse(response.body ?? "{}").error.code).toBe("CONTENT_SERVICE_UNAUTHENTICATED")
    expect(submissions).toBe(5)
  })

  it("rejects a brief without sources with structured issues", async () => {
    const response = await post(
      base,
      "/v1/generate",
      { ...generateBody, brief: { ...generateBody.brief, sources: [] } },
      "key-0003-abcd",
    )
    expect(response.status).toBe(400)
    const error = JSON.parse(response.body ?? "{}").error
    expect(error.code).toBe("CONTENT_SERVICE_BODY_INVALID")
    expect(error.issues.length).toBeGreaterThan(0)
  })

  it("caps request bodies", async () => {
    const response = await post(
      base,
      "/v1/generate",
      { ...generateBody, brief: { ...generateBody.brief, topic: "x".repeat(9000) } },
      "key-0004-abcd",
    )
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body ?? "{}").error.code).toBe("CONTENT_SERVICE_BODY_TOO_LARGE")
  })

  it("accepts evaluate requests and exposes operations by id", async () => {
    const response = await post(
      base,
      "/v1/evaluate",
      { editionId: 101, thresholds: { dimensionMin: 75, overallMin: 80 } },
      "key-0005-abcd",
    )
    expect(response.status).toBe(202)
    const { operation } = JSON.parse(response.body ?? "{}") as {
      operation: OperationSnapshot
    }
    expect(operation.operationType).toBe("evaluate")
    const fetched = await fetch(`${base}/v1/operations/${operation.operationId}`, {
      headers: { authorization: "Bearer test-key" },
    })
    expect(fetched.status).toBe(200)
    expect(
      (JSON.parse(await fetched.text()) as { operation: OperationSnapshot }).operation.operationId,
    ).toBe(operation.operationId)
  })

  it("returns 404 for unknown operations", async () => {
    const response = await fetch(`${base}/v1/operations/missing-op-1`, {
      headers: { authorization: "Bearer test-key" },
    })
    expect(response.status).toBe(404)
    expect(JSON.parse(await response.text()).error.code).toBe("OPERATION_NOT_FOUND")
  })

  it("serves a stable OpenAPI document and healthz", async () => {
    const openapi = await fetch(`${base}/v1/openapi.json`)
    expect(openapi.status).toBe(200)
    const document = (await openapi.json()) as { paths: Record<string, unknown> }
    expect(Object.keys(document.paths).sort()).toEqual([
      "/v1/evaluate",
      "/v1/generate",
      "/v1/openapi.json",
      "/v1/operations/{operationId}",
    ])
    const health = await fetch(`${base}/healthz`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: "alive" })
  })

  it("hashes identical payloads canonically regardless of key order", async () => {
    const reordered = {
      contentId: 12,
      brief: {
        sources: generateBody.brief.sources,
        topic: generateBody.brief.topic,
        intent: generateBody.brief.intent,
      },
      targets: generateBody.targets,
    }
    const first = await post(base, "/v1/generate", generateBody, "key-canonical-1")
    const second = await post(base, "/v1/generate", reordered, "key-canonical-1")
    expect(first.status).toBe(202)
    expect(second.status).toBe(200)
  })
})

export { SHA }

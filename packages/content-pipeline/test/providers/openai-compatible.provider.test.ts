import type { Server } from "node:http"
import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { ProviderConfigurationError, ProviderError } from "../../src/providers/errors.js"
import { CHAT_FIXTURES, deterministicEmbeddingVector } from "../../src/providers/fixtures.js"
import {
  createOpenAICompatibleProvider,
  parseAiProviderEnvironment,
} from "../../src/providers/openai-compatible.js"
import type { LLMProvider, ProviderEvent } from "../../src/providers/types.js"

import { runProviderContractSuite } from "./provider-contract-suite.js"

const API_KEY = "sk-test-secret-key-do-not-log"
const EMBEDDING_DIMENSION = 64

const providerConfig = (baseUrl: string, overrides: Record<string, unknown> = {}) => ({
  apiKey: API_KEY,
  baseUrl,
  chatModel: "test-chat-model",
  embeddingDimension: EMBEDDING_DIMENSION,
  embeddingModel: "test-embedding-model",
  maxResponseBytes: 1_048_576,
  timeoutMs: 60_000,
  ...overrides,
})

type MockHandler = (
  request: http.IncomingMessage,
  body: string,
  response: http.ServerResponse,
) => void

const startServer = async (handler: MockHandler): Promise<{ baseUrl: string; server: Server }> => {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      handler(request, Buffer.concat(chunks).toString("utf8"), response)
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${address.port}`, server }
}

const stopServer = async (server: Server): Promise<void> => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

const jsonResponse = (
  response: http.ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload)
  response.writeHead(status, { "content-type": "application/json", ...headers })
  response.end(body)
}

const chatCompletionOf = (payload: unknown): unknown => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
})

const fixtureHandler: MockHandler = (request, body, response) => {
  const requestId = request.headers["x-request-id"]
  const responseHeaders = typeof requestId === "string" ? { "x-request-id": requestId } : {}
  if (request.url === "/embeddings") {
    const dimension = EMBEDDING_DIMENSION
    jsonResponse(
      response,
      200,
      { data: [{ embedding: deterministicEmbeddingVector(dimension) }] },
      responseHeaders,
    )
    return
  }
  const stage = /Stage ([^:]+):/.exec(JSON.parse(body).messages[0].content as string)?.[1]
  const fixture = CHAT_FIXTURES[stage ?? ""]
  if (fixture === undefined) {
    jsonResponse(
      response,
      404,
      { error: { message: `no fixture for stage ${String(stage)}` } },
      responseHeaders,
    )
    return
  }
  jsonResponse(response, 200, chatCompletionOf(fixture), responseHeaders)
}

const outlineSchema = z.object({ angle: z.string() }).passthrough()

const generateOutline = (provider: LLMProvider, requestId: string) =>
  provider.generate({
    maxOutputTokens: 512,
    promptVersion: "outline-v1",
    requestId,
    schema: outlineSchema,
    system: "CONFIDENTIAL-BODY-MARKER Stage outline-v1: produce strictly valid JSON.",
    temperature: 0,
    user: "CONFIDENTIAL-BODY-MARKER produce the outline.",
  })

const embed = (provider: LLMProvider, requestId: string) =>
  provider.embed({ input: "CONFIDENTIAL-BODY-MARKER duplicate topic", requestId })

const failureOf = async (run: () => Promise<unknown>): Promise<ProviderError> => {
  const failure = await run().catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(ProviderError)
  return failure as ProviderError
}

const events: ProviderEvent[] = []

describe("openai-compatible provider", () => {
  it("sends a bearer key and request id the server can correlate", async () => {
    const seen: { authorization?: string | string[]; requestId?: string | string[] } = {}
    const probe = await startServer((request, _body, response) => {
      seen.authorization = request.headers.authorization
      seen.requestId = request.headers["x-request-id"]
      jsonResponse(response, 200, chatCompletionOf({ angle: "probe" }))
    })
    try {
      const provider = createOpenAICompatibleProvider(providerConfig(probe.baseUrl))
      const result = await generateOutline(provider, "req-correlate-0001")
      expect(result.content.angle).toBe("probe")
      expect(seen.authorization).toBe(`Bearer ${API_KEY}`)
      expect(seen.requestId).toBe("req-correlate-0001")
    } finally {
      await stopServer(probe.server)
    }
  })

  it("classifies timeouts as retryable", async () => {
    const slow = await startServer((_request, _body, response) => {
      setTimeout(() => jsonResponse(response, 200, chatCompletionOf({})), 400)
    })
    try {
      const provider = createOpenAICompatibleProvider(
        providerConfig(slow.baseUrl, { timeoutMs: 40 }),
      )
      const failure = await failureOf(() => generateOutline(provider, "req-timeout-0001"))
      expect(failure.code).toBe("PROVIDER_TIMEOUT")
      expect(failure.retryability).toBe("retryable")
    } finally {
      await stopServer(slow.server)
    }
  })

  it("classifies rate limits with retry-after hints", async () => {
    const limited = await startServer((_request, _body, response) => {
      jsonResponse(response, 429, { error: { message: "slow down" } }, { "retry-after": "2" })
    })
    try {
      const provider = createOpenAICompatibleProvider(providerConfig(limited.baseUrl))
      const withHeader = await failureOf(() => generateOutline(provider, "req-429-0001"))
      expect(withHeader.code).toBe("PROVIDER_RATE_LIMITED")
      expect(withHeader.retryability).toBe("retryable")
      expect(withHeader.retryAfterMs).toBe(2000)
      expect(withHeader.status).toBe(429)
    } finally {
      await stopServer(limited.server)
    }
  })

  it("classifies 5xx as retryable and 401 as terminal", async () => {
    const failing = await startServer((_request, _body, response) => {
      jsonResponse(response, 500, { error: { message: "upstream exploded" } })
    })
    const unauthorized = await startServer((_request, _body, response) => {
      jsonResponse(response, 401, { error: { message: "bad key" } })
    })
    try {
      const retryable = await failureOf(() =>
        generateOutline(
          createOpenAICompatibleProvider(providerConfig(failing.baseUrl)),
          "req-500-0001",
        ),
      )
      expect(retryable.code).toBe("PROVIDER_SERVER_ERROR")
      expect(retryable.retryability).toBe("retryable")

      const terminal = await failureOf(() =>
        generateOutline(
          createOpenAICompatibleProvider(providerConfig(unauthorized.baseUrl)),
          "req-401-0001",
        ),
      )
      expect(terminal.code).toBe("PROVIDER_AUTH_FAILED")
      expect(terminal.retryability).toBe("terminal")
    } finally {
      await stopServer(failing.server)
      await stopServer(unauthorized.server)
    }
  })

  it("classifies malformed payloads as terminal", async () => {
    const garbage = await startServer((_request, _body, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end("not-json{")
    })
    const notStringContent = await startServer((_request, _body, response) => {
      jsonResponse(response, 200, { choices: [{ message: { content: 42 } }] })
    })
    const badInnerJson = await startServer((_request, _body, response) => {
      jsonResponse(response, 200, {
        choices: [{ message: { content: "{definitely-not-json" } }],
      })
    })
    const schemaMismatch = await startServer((_request, _body, response) => {
      jsonResponse(response, 200, chatCompletionOf({ unexpected: true }))
    })
    try {
      for (const [mock, requestId] of [
        [garbage, "req-garbage-0001"],
        [notStringContent, "req-content-0001"],
        [badInnerJson, "req-inner-0001"],
        [schemaMismatch, "req-schema-0001"],
      ] as const) {
        const failure = await failureOf(() =>
          generateOutline(createOpenAICompatibleProvider(providerConfig(mock.baseUrl)), requestId),
        )
        expect(failure.code).toBe("PROVIDER_MALFORMED_RESPONSE")
        expect(failure.retryability).toBe("terminal")
      }
    } finally {
      for (const mock of [garbage, notStringContent, badInnerJson, schemaMismatch]) {
        await stopServer(mock.server)
      }
    }
  })

  it("enforces the response-size limit on declared and actual sizes", async () => {
    const declared = await startServer((_request, _body, response) => {
      const body = "x".repeat(500)
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(body.length),
      })
      response.end(body)
    })
    const chunked = await startServer((_request, _body, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end("x".repeat(500))
    })
    try {
      for (const [mock, requestId] of [
        [declared, "req-size-declared-0001"],
        [chunked, "req-size-actual-0001"],
      ] as const) {
        const failure = await failureOf(() =>
          generateOutline(
            createOpenAICompatibleProvider(providerConfig(mock.baseUrl, { maxResponseBytes: 16 })),
            requestId,
          ),
        )
        expect(failure.code).toBe("PROVIDER_OVERSIZED_RESPONSE")
        expect(failure.retryability).toBe("terminal")
      }
    } finally {
      await stopServer(declared.server)
      await stopServer(chunked.server)
    }
  })

  it("classifies wrong embedding dimensions as terminal", async () => {
    const wrongDimension = await startServer((_request, _body, response) => {
      jsonResponse(response, 200, {
        data: [{ embedding: deterministicEmbeddingVector(EMBEDDING_DIMENSION - 1) }],
      })
    })
    try {
      const failure = await failureOf(() =>
        embed(
          createOpenAICompatibleProvider(providerConfig(wrongDimension.baseUrl)),
          "req-dimension-0001",
        ),
      )
      expect(failure.code).toBe("PROVIDER_DIMENSION_MISMATCH")
      expect(failure.retryability).toBe("terminal")
      expect(failure.message).toContain(String(EMBEDDING_DIMENSION))
    } finally {
      await stopServer(wrongDimension.server)
    }
  })

  it("classifies a connection dropped after submission as retryable", async () => {
    const dropper = await startServer((_request, _body, response) => {
      response.socket?.destroy()
    })
    try {
      const failure = await failureOf(() =>
        generateOutline(
          createOpenAICompatibleProvider(providerConfig(dropper.baseUrl)),
          "req-drop-0001",
        ),
      )
      expect(failure.code).toBe("PROVIDER_CONNECTION_DROPPED")
      expect(failure.retryability).toBe("retryable")
    } finally {
      await stopServer(dropper.server)
    }
  })

  it("parses the AI environment with typed failures and defaults", () => {
    expect(() => parseAiProviderEnvironment({})).toThrow(ProviderConfigurationError)
    try {
      parseAiProviderEnvironment({})
    } catch (error) {
      expect((error as ProviderConfigurationError).variables).toEqual([
        "AI_API_KEY",
        "AI_BASE_URL",
        "AI_CHAT_MODEL",
        "AI_EMBEDDING_MODEL",
      ])
    }
    expect(() =>
      parseAiProviderEnvironment({
        AI_API_KEY: "key",
        AI_BASE_URL: "not-a-url",
        AI_CHAT_MODEL: "m",
        AI_EMBEDDING_MODEL: "e",
      }),
    ).toThrow(ProviderConfigurationError)

    const config = parseAiProviderEnvironment({
      AI_API_KEY: "key",
      AI_BASE_URL: "https://provider.test/v1",
      AI_CHAT_MODEL: "chat",
      AI_EMBEDDING_MODEL: "embed",
    })
    expect(config.timeoutMs).toBe(60_000)
    expect(config.maxResponseBytes).toBe(1_048_576)
    expect(config.embeddingDimension).toBeUndefined()
  })

  it("emits failure events with request ids but never keys or bodies", async () => {
    const failing = await startServer((_request, _body, response) => {
      jsonResponse(response, 500, { error: { message: "boom" } })
    })
    try {
      const provider = createOpenAICompatibleProvider(providerConfig(failing.baseUrl), {
        onEvent: (event) => events.push(event),
      })
      await failureOf(() => generateOutline(provider, "req-fail-events-0001"))
      const serialized = JSON.stringify(events)
      expect(serialized).toContain("req-fail-events-0001")
      expect(serialized).toContain("PROVIDER_SERVER_ERROR")
      expect(serialized).not.toContain(API_KEY)
      expect(serialized).not.toContain("Bearer")
      expect(serialized).not.toContain("CONFIDENTIAL-BODY-MARKER")
    } finally {
      await stopServer(failing.server)
    }
  })
})

const contractMock = await startServer(fixtureHandler)
afterAll(async () => {
  await stopServer(contractMock.server)
})

runProviderContractSuite(
  "openai-compatible(mock)",
  () =>
    createOpenAICompatibleProvider(providerConfig(contractMock.baseUrl), {
      onEvent: (event) => events.push(event),
    }),
  events,
)

import type { PayloadRequest } from "payload"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionClaims } from "../../src/access/session"
import { draftVersionBodySchema } from "../../src/endpoints/internal/contracts"
import {
  INTERNAL_ERROR_CODE,
  configureInternalGuards,
  currentInternalEndpointConfig,
  internalJsonResponse,
  resetInternalGuardsForTests,
  withInternalGuards,
} from "../../src/endpoints/internal/guards"

type FakeRequestOptions = {
  body?: unknown
  headers?: Record<string, string>
  method?: string
  routeParams?: Record<string, unknown>
  user?: unknown
}

const fakeRequest = (options: FakeRequestOptions = {}): PayloadRequest => {
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body)
  return {
    headers: new Headers(options.headers ?? {}),
    json: async () => (bodyText.length === 0 ? {} : JSON.parse(bodyText)),
    method: options.method ?? "GET",
    routeParams: options.routeParams ?? {},
    text: async () => bodyText,
    user: options.user ?? null,
  } as unknown as PayloadRequest
}

const serviceUser = (overrides: Partial<SessionClaims> = {}): SessionClaims =>
  ({
    kind: "service",
    role: "content-service",
    tenantId: 7,
    userId: "42",
    ...overrides,
  }) as unknown as SessionClaims

const userOfClaims = (claims: SessionClaims): unknown => ({
  id: Number(claims.userId),
  role: claims.role,
  tenant: claims.tenantId === null ? null : { id: claims.tenantId },
})

const guardedEcho = () => {
  const handler = vi.fn(async (_req, ctx) =>
    internalJsonResponse(200, { operation: ctx.operation }, ctx.requestId, null),
  )
  const endpoint = withInternalGuards(
    { bodySchema: draftVersionBodySchema, operation: "writeDraftVersion" },
    handler,
  )
  return { endpoint, handler }
}

const errorCodeOf = async (response: Response): Promise<unknown> =>
  (
    (JSON.parse(await response.text()) as Record<string, unknown>)["error"] as Record<
      string,
      unknown
    >
  )["code"]

const responseJson = async (response: Response): Promise<Record<string, unknown>> =>
  JSON.parse(await response.text()) as Record<string, unknown>

describe("internal endpoint guards", () => {
  beforeEach(() => {
    resetInternalGuardsForTests()
    configureInternalGuards({
      allowedOrigins: new Set(["https://trusted.internal"]),
      maxBodyBytes: 4096,
      rateLimitPerMinute: 600,
    })
  })

  afterEach(() => {
    resetInternalGuardsForTests()
    vi.restoreAllMocks()
  })

  it("rejects unauthenticated calls before touching the handler", async () => {
    const { endpoint, handler } = guardedEcho()
    const response = await endpoint(fakeRequest())
    expect(response.status).toBe(401)
    expect(await errorCodeOf(response)).toBe(INTERNAL_ERROR_CODE.UNAUTHENTICATED)
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects non-service roles even when authenticated", async () => {
    const { endpoint, handler } = guardedEcho()
    const response = await endpoint(
      fakeRequest({ user: userOfClaims(serviceUser({ kind: "user", role: "editor" })) }),
    )
    expect(response.status).toBe(403)
    expect(await errorCodeOf(response)).toBe(INTERNAL_ERROR_CODE.FORBIDDEN)
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects schema-invalid bodies with field paths", async () => {
    const { endpoint } = guardedEcho()
    const response = await endpoint(
      fakeRequest({
        body: { title: "" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(response.status).toBe(400)
    const body = await responseJson(response)
    expect((body["error"] as Record<string, unknown>)["code"]).toBe(
      INTERNAL_ERROR_CODE.BODY_INVALID,
    )
    expect(
      Array.isArray(
        ((body["error"] as Record<string, unknown>)["issues"] as unknown[] | undefined) ?? [],
      ),
    ).toBe(true)
  })

  it("rejects non-JSON bodies", async () => {
    const { endpoint } = guardedEcho()
    const broken = fakeRequest({ method: "POST", user: userOfClaims(serviceUser()) })
    const response = await endpoint({
      ...broken,
      text: async () => "not-json{",
    } as PayloadRequest)
    expect(response.status).toBe(400)
    expect(await errorCodeOf(response)).toBe(INTERNAL_ERROR_CODE.BODY_INVALID)
  })

  it("rejects bodies over the configured size via content-length and bytes", async () => {
    const { endpoint, handler } = guardedEcho()
    const declared = await endpoint(
      fakeRequest({
        headers: { "content-length": "9999999" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(declared.status).toBe(413)
    expect(handler).not.toHaveBeenCalled()

    const oversized = fakeRequest({
      body: { title: "x".repeat(5000) },
      method: "POST",
      user: userOfClaims(serviceUser()),
    })
    const actual = await endpoint(oversized)
    expect(actual.status).toBe(413)
    expect(await errorCodeOf(actual)).toBe(INTERNAL_ERROR_CODE.BODY_TOO_LARGE)
  })

  it("rate limits per identity and operation and answers 429 with retry-after", async () => {
    configureInternalGuards({
      allowedOrigins: new Set(),
      maxBodyBytes: 4096,
      rateLimitPerMinute: 2,
    })
    const { endpoint } = guardedEcho()
    const user = userOfClaims(serviceUser())
    const call = () => endpoint(fakeRequest({ body: { title: "ok" }, method: "POST", user }))
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)
    const limited = await call()
    expect(limited.status).toBe(429)
    expect(await errorCodeOf(limited)).toBe(INTERNAL_ERROR_CODE.RATE_LIMITED)
    expect(limited.headers.get("retry-after")).not.toBeNull()
  })

  it("echoes a valid request id and rejects malformed ones", async () => {
    const { endpoint } = guardedEcho()
    const ok = await endpoint(
      fakeRequest({
        body: { title: "ok" },
        headers: { "x-request-id": "req-0001-abcd" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(ok.headers.get("x-request-id")).toBe("req-0001-abcd")

    const invalid = await endpoint(
      fakeRequest({
        headers: { "x-request-id": "bad id!" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(invalid.status).toBe(400)
    expect(await errorCodeOf(invalid)).toBe(INTERNAL_ERROR_CODE.REQUEST_ID_INVALID)
  })

  it("rejects malformed operation ids", async () => {
    const { endpoint } = guardedEcho()
    const response = await endpoint(
      fakeRequest({
        body: { title: "ok" },
        headers: { "x-operation-id": "no spaces allowed" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(response.status).toBe(400)
    expect(await errorCodeOf(response)).toBe(INTERNAL_ERROR_CODE.OPERATION_ID_INVALID)
  })

  it("never emits permissive CORS headers for disallowed origins", async () => {
    const { endpoint } = guardedEcho()
    const response = await endpoint(
      fakeRequest({
        body: { title: "ok" },
        headers: { origin: "https://evil.example" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("vary")).toBe("Origin")
  })

  it("answers allowed origins with an explicit ACAO echo and preflights with 204", async () => {
    const { endpoint } = guardedEcho()
    const allowed = await endpoint(
      fakeRequest({
        body: { title: "ok" },
        headers: { origin: "https://trusted.internal" },
        method: "POST",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://trusted.internal")

    const preflight = await endpoint(
      fakeRequest({
        headers: { origin: "https://trusted.internal" },
        method: "OPTIONS",
        user: userOfClaims(serviceUser()),
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://trusted.internal")
  })

  it("sanitizes unexpected handler failures without leaking internals", async () => {
    const endpoint = withInternalGuards(
      { bodySchema: null, operation: "getEditionInput" },
      async () => {
        throw new Error("password=hunter2 secretKey at /srv/cms/.env")
      },
    )
    const response = await endpoint(fakeRequest({ user: userOfClaims(serviceUser()) }))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toMatch(/password|secret|hunter2|stack/i)
    const body = JSON.parse(text)
    expect(body.error.code).toBe(INTERNAL_ERROR_CODE.INTERNAL)
    expect(typeof body.error.requestId).toBe("string")
  })

  it("defaults limits from the environment parser", () => {
    const config = currentInternalEndpointConfig()
    expect(config.maxBodyBytes).toBeGreaterThan(0)
    expect(config.rateLimitPerMinute).toBeGreaterThan(0)
  })
})

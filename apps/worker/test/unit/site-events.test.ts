import { readFileSync, statSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SITE_EVENT_ID_HEADER,
  SITE_EVENT_SIGNATURE_HEADER,
  siteEventBodyOf,
  siteEventJobDataOf,
  verifySiteEventBody,
} from "@geo/content-client"

import { createSiteEventProcessor } from "../../src/processors/site-events.js"

const SECRET = "webhook-secret-399"

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  }
})

const eventOf = () =>
  siteEventJobDataOf({
    eventType: "published",
    hostname: "e2e-site-events-399.test",
    manifestSha256: "a".repeat(64),
    occurredAt: "2026-09-24T00:00:00.000Z",
    releaseId: "rel-e2e-se-399",
    secretReference: "site-webhook-399",
    siteId: 399,
    tenantId: 413,
    webhookUrl: "http://127.0.0.1:18099/hook",
  })

const jobOf = (data: unknown) => ({
  data,
  id: "se-job-1",
  name: "fetch",
  queueName: "site-events",
})

const responseOf = (status: number) => ({ ok: status >= 200 && status < 300, status })

describe("createSiteEventProcessor", () => {
  const mockStat = vi.mocked(statSync)
  const mockRead = vi.mocked(readFileSync)
  let restoreGetUid: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    // Windows 上 process.getuid 属性不存在（vi.spyOn 会直接报错），
    // 统一用 defineProperty 注入 uid=0，与 mock 的 statSync 属主一致。
    const original = Object.getOwnPropertyDescriptor(process, "getuid")
    Object.defineProperty(process, "getuid", { value: () => 0, configurable: true })
    restoreGetUid = () => {
      if (original === undefined) delete (process as Record<string, unknown>)["getuid"]
      else Object.defineProperty(process, "getuid", original)
    }
    mockStat.mockReturnValue({ uid: 0, mode: 0o600 } as never)
    mockRead.mockReturnValue(SECRET)
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreGetUid()
    vi.clearAllMocks()
  })

  const makeProcessor = (fetchMock: ReturnType<typeof vi.fn>) => {
    const client = { recordSiteEventDelivery: vi.fn(async () => undefined) }
    const processor = createSiteEventProcessor(client, () => undefined, {
      credentialDirectory: "/tmp/site-webhook-creds",
      fetchImpl: fetchMock as never,
    })
    return { client, processor }
  }

  it("delivers with a valid signature and reports delivered", async () => {
    const event = eventOf()
    const fetchMock = vi.fn(async () => responseOf(200))
    const { client, processor } = makeProcessor(fetchMock)

    const result = await processor(jobOf(event))

    expect(result).toEqual({ eventId: event.eventId, state: "delivered" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(event.webhookUrl)
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    const body = JSON.stringify(siteEventBodyOf(event))
    expect(headers[SITE_EVENT_ID_HEADER]).toBe(event.eventId)
    expect(verifySiteEventBody(SECRET, body, headers[SITE_EVENT_SIGNATURE_HEADER])).toBe(true)
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith({
      attemptCount: 1,
      error: null,
      eventType: "published",
      eventId: event.eventId,
      hostname: event.hostname,
      lastStatusCode: 200,
      releaseId: event.releaseId,
      siteId: 399,
      state: "delivered",
      tenantId: 413,
      webhookUrl: event.webhookUrl,
    })
  })

  it("retries with backoff and reports the real attempt count", async () => {
    const event = eventOf()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseOf(500))
      .mockResolvedValueOnce(responseOf(500))
      .mockResolvedValueOnce(responseOf(200))
    const { client, processor } = makeProcessor(fetchMock)

    const pending = processor(jobOf(event))
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await pending

    expect(result.state).toBe("delivered")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 3, state: "delivered" }),
    )
  })

  it("dead-letters after exhausting attempts (no throw)", async () => {
    const event = eventOf()
    const fetchMock = vi.fn(async () => responseOf(500))
    const { client, processor } = makeProcessor(fetchMock)

    const pending = processor(jobOf(event))
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await pending

    expect(result.state).toBe("failed")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 3,
        error: "HTTP_500",
        lastStatusCode: 500,
        state: "failed",
      }),
    )
  })

  it("dead-letters network failures without a status code", async () => {
    const event = eventOf()
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED")
    })
    const { client, processor } = makeProcessor(fetchMock)

    const pending = processor(jobOf(event))
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await pending

    expect(result.state).toBe("failed")
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 3,
        error: expect.stringContaining("ECONNREFUSED"),
        lastStatusCode: null,
        state: "failed",
      }),
    )
  })

  it("dead-letters immediately when the credential directory is unset", async () => {
    const event = eventOf()
    const fetchMock = vi.fn()
    const client = { recordSiteEventDelivery: vi.fn(async () => undefined) }
    const processor = createSiteEventProcessor(client, () => undefined, {
      credentialDirectory: undefined,
      fetchImpl: fetchMock as never,
    })

    const result = await processor(jobOf(event))

    expect(result.state).toBe("failed")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 0,
        error: "SITE_WEBHOOK_CREDENTIALS_DIR_MISSING",
        state: "failed",
      }),
    )
  })

  it("dead-letters when the secret file is unreadable", async () => {
    const event = eventOf()
    mockStat.mockImplementation(() => {
      throw new Error("ENOENT")
    })
    const fetchMock = vi.fn()
    const { client, processor } = makeProcessor(fetchMock)

    const result = await processor(jobOf(event))

    expect(result.state).toBe("failed")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(client.recordSiteEventDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 0,
        error: "WORKER_CREDENTIAL_FILE_MISSING:GEO_FOUNDRY_SITE_WEBHOOK_SECRET",
        state: "failed",
      }),
    )
  })

  it("ends poison payloads without reporting or fetching", async () => {
    const fetchMock = vi.fn()
    const { client, processor } = makeProcessor(fetchMock)

    const result = await processor(jobOf({ surprise: true }))

    expect(result).toEqual({ eventId: null, state: "poison" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(client.recordSiteEventDelivery).not.toHaveBeenCalled()
  })
})

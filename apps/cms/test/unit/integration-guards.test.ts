/*
 * 集成面守卫：限流、请求体上限、幂等键格式，以及幂等派生哈希的优先级。
 * Cookie 会话绕过守卫的行为在 intake-ops 路由层（machineBody 为 null），
 * 这里测守卫本体；绕过语义由「API-Key 身份才调用」的接线保证。
 */

import { afterEach, describe, expect, it } from "vitest"

import {
  configureIntegrationGuardsForTests,
  derivedIdempotencyHashOf,
  INTEGRATION_IDEMPOTENCY_KEY_PATTERN,
  integrationGuardOf,
  isDerivedIdempotencyHash,
} from "../../src/server/http/integration-guards"

const CONFIG = { maxBodyBytes: 1_000, rateLimitPerMinute: 3 }

afterEach(() => {
  configureIntegrationGuardsForTests(null)
})

const statusOf = (response: Response | null): number | null =>
  response === null ? null : response.status

describe("integration guard rate limit", () => {
  it("Given a per-minute limit, when more requests arrive, then the excess is rejected with 429", () => {
    configureIntegrationGuardsForTests(CONFIG)
    const results: (number | null)[] = []
    for (let index = 0; index < 5; index += 1) {
      const guard = integrationGuardOf({
        actorKey: "automation-1",
        bodyBytes: 10,
        idempotencyKey: null,
      })
      results.push(statusOf(guard))
    }
    expect(results.slice(0, 3)).toEqual([null, null, null])
    expect(results.slice(3)).toEqual([429, 429])
  })

  it("Given two identities, when one exhausts its window, then the other is unaffected", () => {
    configureIntegrationGuardsForTests(CONFIG)
    for (let index = 0; index < 3; index += 1) {
      expect(
        statusOf(integrationGuardOf({ actorKey: "noisy", bodyBytes: 10, idempotencyKey: null })),
      ).toBeNull()
    }
    expect(
      statusOf(integrationGuardOf({ actorKey: "quiet", bodyBytes: 10, idempotencyKey: null })),
    ).toBeNull()
    expect(
      statusOf(integrationGuardOf({ actorKey: "noisy", bodyBytes: 10, idempotencyKey: null })),
    ).toBe(429)
  })
})

describe("integration guard body cap and idempotency key", () => {
  it("Given a body over the cap, when guarded, then it is rejected with 413 before rate limiting", () => {
    configureIntegrationGuardsForTests(CONFIG)
    const guard = integrationGuardOf({
      actorKey: "big-body",
      bodyBytes: CONFIG.maxBodyBytes + 1,
      idempotencyKey: null,
    })
    expect(statusOf(guard)).toBe(413)
  })

  it("Given a malformed idempotency key, when guarded, then it is rejected with 400", () => {
    configureIntegrationGuardsForTests(CONFIG)
    const guard = integrationGuardOf({
      actorKey: "bad-key",
      bodyBytes: 10,
      idempotencyKey: "短",
    })
    expect(statusOf(guard)).toBe(400)
  })

  it("Given the documented key shape, when validated, then the pattern accepts it", () => {
    expect(INTEGRATION_IDEMPOTENCY_KEY_PATTERN.test("n8n-retry-20260918")).toBe(true)
    expect(INTEGRATION_IDEMPOTENCY_KEY_PATTERN.test("has space")).toBe(false)
    expect(INTEGRATION_IDEMPOTENCY_KEY_PATTERN.test("short")).toBe(false)
  })
})

describe("derived idempotency hash", () => {
  it("Given a caller-provided contentHash, when derived, then no override happens (content addressing wins)", () => {
    expect(
      derivedIdempotencyHashOf({ contentHash: "abc123", idempotencyKey: "n8n-key-1" }),
    ).toBeUndefined()
  })

  it("Given webhook bodyMarkdown, when derived, then the hash is content-addressed by the body", () => {
    const first = derivedIdempotencyHashOf({ bodyMarkdown: "# 同一篇", idempotencyKey: null })
    const second = derivedIdempotencyHashOf({ bodyMarkdown: "# 同一篇", idempotencyKey: null })
    const other = derivedIdempotencyHashOf({ bodyMarkdown: "# 另一篇", idempotencyKey: null })
    expect(first).toMatch(/^webhook:[0-9a-f]{64}$/)
    expect(first).toBe(second)
    expect(first).not.toBe(other)
  })

  it("Given only an Idempotency-Key, when derived, then retries with the same key map to one hash", () => {
    const first = derivedIdempotencyHashOf({ idempotencyKey: "n8n-retry-20260918" })
    const second = derivedIdempotencyHashOf({ idempotencyKey: "n8n-retry-20260918" })
    expect(first).toMatch(/^idem:[0-9a-f]{64}$/)
    expect(first).toBe(second)
  })

  it("Given neither hash source, when derived, then there is no derived hash", () => {
    expect(derivedIdempotencyHashOf({ idempotencyKey: null })).toBeUndefined()
    expect(derivedIdempotencyHashOf({})).toBeUndefined()
  })

  it("Given a stored hash, when classified, then only derived prefixes take the replay fast path", () => {
    expect(isDerivedIdempotencyHash("webhook:deadbeef")).toBe(true)
    expect(isDerivedIdempotencyHash("idem:deadbeef")).toBe(true)
    /* 调用方自带 contentHash 不是派生值：命中后仍按普通重复处理。 */
    expect(isDerivedIdempotencyHash("caller-hash")).toBe(false)
    expect(isDerivedIdempotencyHash(undefined)).toBe(false)
  })
})

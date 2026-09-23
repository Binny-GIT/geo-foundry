import { describe, expect, it } from "vitest"

import { authorizeSiteRequest, bearerTokenOf, QuotaTracker, quotaBucketKeyOf } from "../../src/auth/site-auth.js"
import { parseSiteKeyring } from "../../src/config/site-keyring.js"

const NOW = Date.parse("2026-09-23T00:00:00.000Z")

const keyring = parseSiteKeyring({
  sites: {
    "site-a.test": {
      keys: [
        { expiresAt: null, key: "active-key-for-site-a-0000", quotaPerMinute: 5, status: "active" },
        { expiresAt: null, key: "revoked-key-for-site-a-0000", quotaPerMinute: 5, status: "revoked" },
        {
          expiresAt: "2020-01-01T00:00:00.000Z",
          key: "expired-key-for-site-a-0000",
          quotaPerMinute: 5,
          status: "active",
        },
      ],
    },
  },
})

describe("bearerTokenOf", () => {
  it("extracts the token from a well-formed Bearer header", () => {
    expect(bearerTokenOf("Bearer abc123")).toBe("abc123")
  })

  it("returns null for missing or malformed headers", () => {
    expect(bearerTokenOf(undefined)).toBeNull()
    expect(bearerTokenOf(null)).toBeNull()
    expect(bearerTokenOf("")).toBeNull()
    expect(bearerTokenOf("Basic abc123")).toBeNull()
    expect(bearerTokenOf("Bearer")).toBeNull()
  })
})

describe("authorizeSiteRequest", () => {
  it("requires credentials when the Authorization header is absent", () => {
    expect(authorizeSiteRequest(keyring, "site-a.test", undefined, NOW)).toEqual({
      kind: "missing-credentials",
    })
  })

  it("rejects a token that does not match any key registered for the host", () => {
    expect(authorizeSiteRequest(keyring, "site-a.test", "Bearer nope", NOW)).toEqual({
      kind: "invalid-key",
    })
  })

  it("rejects a token for a host that has no keyring entry at all", () => {
    expect(
      authorizeSiteRequest(keyring, "unregistered.test", "Bearer active-key-for-site-a-0000", NOW),
    ).toEqual({ kind: "invalid-key" })
  })

  it("rejects a revoked key per the credential file's own status field", () => {
    expect(authorizeSiteRequest(keyring, "site-a.test", "Bearer revoked-key-for-site-a-0000", NOW)).toEqual({
      kind: "revoked",
    })
  })

  it("rejects a key past its expiresAt", () => {
    expect(authorizeSiteRequest(keyring, "site-a.test", "Bearer expired-key-for-site-a-0000", NOW)).toEqual({
      kind: "expired",
    })
  })

  it("accepts an active, unexpired key and is case-insensitive on the host", () => {
    const decision = authorizeSiteRequest(keyring, "SITE-A.TEST", "Bearer active-key-for-site-a-0000", NOW)
    expect(decision.kind).toBe("ok")
    if (decision.kind !== "ok") throw new Error("expected ok")
    expect(decision.entry.quotaPerMinute).toBe(5)
  })
})

describe("QuotaTracker", () => {
  it("allows up to the limit within a window and rejects beyond it", () => {
    const tracker = new QuotaTracker(60_000)
    const bucket = "site-a.test\u0000active-key-for-site-a-0000"
    for (let i = 0; i < 5; i += 1) {
      expect(tracker.consume(bucket, 5, 0)).toEqual({ allowed: true })
    }
    const rejected = tracker.consume(bucket, 5, 0)
    expect(rejected.allowed).toBe(false)
    if (rejected.allowed) throw new Error("expected rejection")
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("resets the bucket once the window elapses", () => {
    const tracker = new QuotaTracker(1_000)
    const bucket = "site-a.test\u0000active-key-for-site-a-0000"
    expect(tracker.consume(bucket, 1, 0)).toEqual({ allowed: true })
    expect(tracker.consume(bucket, 1, 0).allowed).toBe(false)
    expect(tracker.consume(bucket, 1, 1_001)).toEqual({ allowed: true })
  })
})

describe("quotaBucketKeyOf", () => {
  it("combines the lower-cased host and the matched key into one bucket identity", () => {
    const entry = { expiresAt: null, key: "K", quotaPerMinute: 1, status: "active" as const }
    expect(quotaBucketKeyOf("Site-A.TEST", entry)).toBe("site-a.test\u0000K")
  })
})

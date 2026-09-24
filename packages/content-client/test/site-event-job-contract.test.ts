import { describe, expect, it } from "vitest"

import {
  siteEventBodyOf,
  siteEventIdOf,
  siteEventJobDataOf,
  signSiteEventBody,
  verifySiteEventBody,
} from "../src/site-event-job.js"
import { parseSiteEventJobData } from "../src/index.js"

const base = {
  eventType: "published" as const,
  hostname: "e2e-scheduled-publish-375.test",
  manifestSha256: "a".repeat(64),
  occurredAt: "2026-09-23T18:59:29.030Z",
  releaseId: "rel-da37deb4c03664d7f67d889a",
  secretReference: "site-webhook-375",
  siteId: 375,
  tenantId: 413,
  webhookUrl: "http://127.0.0.1:18099/hook",
}

describe("siteEventIdOf", () => {
  it("is deterministic and stable across releases of the same identity", () => {
    const a = siteEventIdOf({ eventType: "published", releaseId: "rel-x", siteId: 375 })
    const b = siteEventIdOf({ eventType: "published", releaseId: "rel-x", siteId: 375 })
    expect(a).toBe(b)
    expect(a).toMatch(/^evt-[0-9a-f]{24}$/)
  })

  it("differs by site, release, or event type", () => {
    const published = siteEventIdOf({ eventType: "published", releaseId: "rel-x", siteId: 375 })
    expect(siteEventIdOf({ eventType: "updated", releaseId: "rel-x", siteId: 375 })).not.toBe(
      published,
    )
    expect(siteEventIdOf({ eventType: "published", releaseId: "rel-y", siteId: 375 })).not.toBe(
      published,
    )
    expect(siteEventIdOf({ eventType: "published", releaseId: "rel-x", siteId: 376 })).not.toBe(
      published,
    )
  })
})

describe("siteEventJobDataOf / parse roundtrip", () => {
  it("builds job data with the derived eventId and parses it back", () => {
    const data = siteEventJobDataOf(base)
    expect(data.eventId).toBe(siteEventIdOf({ ...base, releaseId: base.releaseId }))
    const parsed = parseSiteEventJobData(JSON.parse(JSON.stringify(data)))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual(data)
  })

  it("rejects unknown fields and missing webhook", () => {
    const data = siteEventJobDataOf(base)
    const withExtra = { ...data, surprise: 1 }
    expect(parseSiteEventJobData(withExtra).success).toBe(false)
    expect(parseSiteEventJobData({ ...data, webhookUrl: "" }).success).toBe(false)
  })

  it("builds a consumer body without internal-only fields", () => {
    const body = siteEventBodyOf(siteEventJobDataOf(base))
    expect(body).toEqual({
      eventId: siteEventIdOf({ ...base, releaseId: base.releaseId }),
      eventType: "published",
      hostname: base.hostname,
      manifestSha256: base.manifestSha256,
      occurredAt: base.occurredAt,
      releaseId: base.releaseId,
      siteId: base.siteId,
    })
    expect("tenantId" in body).toBe(false)
    expect("webhookSecretReference" in body).toBe(false)
    expect("webhookUrl" in body).toBe(false)
  })
})

describe("sign / verify", () => {
  it("roundtrips over the exact serialized bytes", () => {
    const data = siteEventJobDataOf(base)
    const body = JSON.stringify(siteEventBodyOf(data))
    const signature = signSiteEventBody("top-secret", body)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(verifySiteEventBody("top-secret", body, signature)).toBe(true)
  })

  it("rejects tampered body, wrong secret, or missing header", () => {
    const data = siteEventJobDataOf(base)
    const body = JSON.stringify(siteEventBodyOf(data))
    const signature = signSiteEventBody("top-secret", body)
    expect(verifySiteEventBody("top-secret", body + " ", signature)).toBe(false)
    expect(verifySiteEventBody("other-secret", body, signature)).toBe(false)
    expect(verifySiteEventBody("top-secret", body, undefined)).toBe(false)
  })
})

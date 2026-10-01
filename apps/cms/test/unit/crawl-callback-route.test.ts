import { createHmac, randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => ({
  enqueue: vi.fn(async () => "queued"),
  job: { id: 1, jobId: "job_1234567890abcdef", tenantId: 2, parentIntakeItemId: 3, deliveryId: null as string | null, state: "dispatched" },
  present: true,
}))
vi.mock("../../src/server/jobs/pgboss", () => ({ sendCrawlJobWithin: fixtures.enqueue }))
vi.mock("../../src/config/credentials", () => ({ readFileCredential: () => "test-secret" }))
vi.mock("../../src/server/runtime", () => ({
  serverRuntime: () => ({ db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () =>
      fixtures.present ? [{ job: fixtures.job, secretReference: "test-ref" }] : [] }) }) }) }),
    transaction: async (callback: (tx: object) => Promise<void>) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [fixtures.job] }) }) }),
      update: () => ({ set: (values: object) => ({ where: async () => Object.assign(fixtures.job, values) }) }),
    }),
  } }),
}))

import { handleCrawlCallback } from "../../src/server/routes/crawl-callbacks"

describe("crawl 回调入站", () => {
  const slug = ["integration", "crawl-callbacks"]
  beforeEach(() => {
    fixtures.present = true
    fixtures.job.deliveryId = null
    fixtures.job.state = "dispatched"
    fixtures.enqueue.mockClear()
    process.env["GEO_FOUNDRY_CRAWL_CREDENTIALS_DIR"] = "/unused"
  })
  const signed = (deliveryId: string): Request => {
    const body = JSON.stringify({ deliveryId, jobId: fixtures.job.jobId, status: "succeeded", occurredAt: new Date().toISOString() })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac("sha256", "test-secret").update(`${timestamp}.${body}`).digest("hex")
    return new Request("http://localhost/api/integration/crawl-callbacks", {
      method: "POST", body,
      headers: { "x-crawl-delivery-id": deliveryId, "x-crawl-timestamp": timestamp,
        "x-crawl-signature": `sha256=${signature}` },
    })
  }

  it("Given a signed delivery, when replayed, then both responses are 202 and only one job is queued", async () => {
    const delivery = randomUUID()
    expect((await handleCrawlCallback(signed(delivery), slug))?.status).toBe(202)
    expect((await handleCrawlCallback(signed(delivery), slug))?.status).toBe(202)
    expect(fixtures.enqueue).toHaveBeenCalledTimes(1)
  })
  it("Given an unknown job, when notified, then returns 404 without enqueue", async () => {
    fixtures.present = false
    expect((await handleCrawlCallback(signed(randomUUID()), slug))?.status).toBe(404)
    expect(fixtures.enqueue).not.toHaveBeenCalled()
  })
})

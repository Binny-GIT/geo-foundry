import { ContentClientError } from "@geo/content-client"
import { describe, expect, it } from "vitest"

import { createIntakeProcessor } from "../../src/processors/intake.js"

describe("intake processor", () => {
  it("records permanent invalid source failures in the CMS instead of retrying", async () => {
    const failures: unknown[] = []
    const processor = createIntakeProcessor({
      client: {
        claimIntakeFetch: async () => {},
        completeIntakeFetch: async () => ({ intakeItemId: 12, snapshotId: 1 }),
        createRssEntries: async () => [],
        failIntakeFetch: async (_id: number, failure: unknown) => {
          failures.push(failure)
        },
        getIntakeFetchInput: async () => ({
          channel: "url" as const,
          intakeItemId: 12,
          sourceUrl: "http://127.0.0.1/private",
          tenantId: 7,
        }),
      },
      enqueue: async () => {},
      logger: () => {},
      snapshots: { put: async () => ({ contentHash: "a".repeat(64), contentLength: 1, contentType: "text/plain", storageKey: "objects/x" }) },
    })

    await expect(
      processor({
        attemptsMade: 0,
        data: { intakeItemId: 12, tenantId: 7 },
        id: "intake-12",
        opts: { attempts: 3 },
        queueName: "content-intake",
      } as never),
    ).resolves.toEqual({ intakeItemId: 12, state: "failed" })
    expect(failures).toEqual([{ code: "INTAKE_URL_PRIVATE_ADDRESS", reason: "INTAKE_URL_PRIVATE_ADDRESS" }])
  })

  it("skips stale work after a human changes the intake state", async () => {
    const processor = createIntakeProcessor({
      client: {
        claimIntakeFetch: async () => {
          throw new ContentClientError("INTAKE_FETCH_STATE_INVALID", 409, "req-intake-stale")
        },
      },
      enqueue: async () => {},
      logger: () => {},
      snapshots: { put: async () => ({ contentHash: "a".repeat(64), contentLength: 1, contentType: "text/plain", storageKey: "objects/x" }) },
    })

    await expect(
      processor({
        attemptsMade: 0,
        data: { intakeItemId: 12, tenantId: 7 },
        id: "intake-12",
        opts: { attempts: 3 },
        queueName: "content-intake",
      } as never),
    ).resolves.toEqual({ intakeItemId: 12, state: "skipped" })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.hoisted(() => vi.fn(async () => null))
vi.mock("../../src/server/jobs/pgboss", () => ({ sendRoutingSyncJobWithin: send }))
vi.mock("../../src/server/repositories/console-collections", () => ({
  findConsoleRecord: async () => ({ id: 4 }),
}))

import { updateSite } from "../../src/server/repositories/entity-writes"

describe("site status routing transaction", () => {
  beforeEach(() => send.mockReset().mockResolvedValue(null))

  it.each([
    ["active", "disabled"],
    ["disabled", "active"],
  ])("enqueues %s to %s within the same transaction", async (from, to) => {
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: from, tenantId: 9 }] }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }
    const db = { transaction: async (work: (value: typeof tx) => Promise<void>) => work(tx) }

    await updateSite(db as never, { kind: "global" }, 4, { status: to })

    expect(send).toHaveBeenCalledWith(tx, { siteId: 4, tenantId: 9 })
  })

  it("rolls back the status change when the enqueue fails", async () => {
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: "active", tenantId: 9 }] }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }
    const db = { transaction: async (work: (value: typeof tx) => Promise<void>) => work(tx) }
    send.mockRejectedValueOnce(new Error("queue unavailable"))

    await expect(updateSite(db as never, { kind: "global" }, 4, { status: "disabled" })).rejects.toThrow("queue unavailable")
  })
})

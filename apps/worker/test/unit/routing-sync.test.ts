import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({ publish: vi.fn(), sites: [] as { siteId: number; canonicalDomain: string }[] }))

vi.mock("@geo/publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@geo/publisher")>()),
  createS3RoutingStore: () => ({}),
  publishRoutingManifest: calls.publish,
}))
vi.mock("../../src/config/credentials.js", () => ({ workerCredentialOf: () => "fixture-key" }))

import { syncGlobalRoutingManifest } from "../../src/processors/release-pipeline.js"

describe("global routing sync", () => {
  beforeEach(() => {
    calls.publish.mockReset()
    calls.sites = [
      { siteId: 1, canonicalDomain: "one.test" },
      { siteId: 2, canonicalDomain: "two.test" },
    ]
  })

  it("drops a disabled site from the next published manifest", async () => {
    const context = { client: { getPublishedSites: async () => ({ sites: calls.sites }) } } as never
    await syncGlobalRoutingManifest(context)
    calls.sites = [{ siteId: 1, canonicalDomain: "one.test" }]

    await syncGlobalRoutingManifest(context)

    expect(calls.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ manifest: { hosts: [{ canonical: true, host: "one.test", siteId: "site-1" }], schemaVersion: 1 } }),
    )
  })

  it("publishes an empty manifest when the last site is disabled", async () => {
    calls.sites = []
    const context = { client: { getPublishedSites: async () => ({ sites: calls.sites }) } } as never

    await syncGlobalRoutingManifest(context)

    expect(calls.publish).toHaveBeenCalledWith(
      expect.objectContaining({ manifest: { hosts: [], schemaVersion: 1 }, sitePointerObjectKeys: [] }),
    )
  })
})

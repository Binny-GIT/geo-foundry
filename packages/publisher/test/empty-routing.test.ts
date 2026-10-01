import { ETagSchema, RoutingManifestPointerSchema } from "@geo/schema/release/v1"
import { describe, expect, it } from "vitest"

import { publishRoutingManifest, type S3RoutingStore } from "../src/routing-publish.js"

describe("routing publisher", () => {
  it("advances the current pointer to an empty manifest instead of removing it", async () => {
    let pointer: Uint8Array | null = null
    const manifests = new Map<string, Uint8Array>()
    const etag = ETagSchema.parse('"fixture-etag"')
    const store: S3RoutingStore = {
      putManifestIfAbsent: async ({ routingId, body }) => {
        manifests.set(routingId, body)
        return etag
      },
      headPointer: async () => (pointer === null ? null : etag),
      readPointer: async () => {
        if (pointer === null) throw new Error("missing pointer")
        return pointer
      },
      compareAndSwapPointer: async ({ body }) => {
        pointer = body
        return etag
      },
      createPointerIfAbsent: async ({ body }) => {
        pointer = body
        return etag
      },
      headSiteReleaseManifest: async () => true,
      headSitePointer: async () => true,
    }
    const publish = (
      routingId: string,
      hosts: readonly {
        readonly canonical: boolean
        readonly host: string
        readonly siteId: string
      }[],
    ) =>
      publishRoutingManifest({
        manifest: { hosts, schemaVersion: 1 },
        routingId,
        routingStore: store,
        sitePointerObjectKeys: [],
        siteReleaseObjectKeys: [],
        updatedAt: "2026-09-30T00:00:00.000Z",
      })
    await publish("routing-one", [{ canonical: true, host: "one.test", siteId: "site-1" }])

    await publish("routing-empty", [])

    expect(pointer).not.toBeNull()
    const parsed = RoutingManifestPointerSchema.parse(
      JSON.parse(new TextDecoder().decode(pointer ?? new Uint8Array())),
    )
    expect(parsed.routingId).toBe("routing-empty")
    expect(JSON.parse(new TextDecoder().decode(manifests.get("routing-empty")))).toEqual({
      hosts: [],
      schemaVersion: 1,
    })
  })
})

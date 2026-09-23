import { describe, expect, it } from "vitest"

import { createMediaResolver, MEDIA_UNAVAILABLE_CODE } from "../../src/runtime/media.js"
import { buildSiteRelease, fixtureMediaBytes, installRouting, MemoryObjectReader } from "./fixtures.js"

const worldOf = async () => {
  const store = new MemoryObjectReader()
  const mapBytes = fixtureMediaBytes("map.webp")
  const release = await buildSiteRelease({
    canonicalDomain: "site-a.test",
    media: [{ bytes: mapBytes, contentType: "image/webp", filename: "map.webp" }],
    releaseId: "release-a-v1",
    siteId: "site-a",
    store,
  })
  store.put(release.pointerKey, release.pointerBody)
  await installRouting(store, "routing-v1", [{ canonical: true, host: "site-a.test", siteId: "site-a" }])
  return { mapBytes, release, store }
}

describe("resolveMedia", () => {
  it("verifies bytes against the manifest sha256 and serves the object", async () => {
    const world = await worldOf()
    const resolver = createMediaResolver({ store: world.store })

    const result = await resolver.resolveMedia({ filename: "map.webp", hostname: "site-a.test" })
    expect(result).toMatchObject({
      contentType: "image/webp",
      kind: "media",
      releaseId: "release-a-v1",
      siteId: "site-a",
      status: 200,
    })
    if (result.kind !== "media") throw new Error("expected media result")
    expect(new TextDecoder().decode(result.body)).toBe(new TextDecoder().decode(world.mapBytes))
  })

  it("fails closed with 503 when stored bytes no longer match the manifest hash", async () => {
    const world = await worldOf()
    const key = `sites/site-a/releases/${world.release.releaseId}/media/map.webp`
    world.store.put(key, new TextEncoder().encode("tampered bytes"), "image/webp")
    const resolver = createMediaResolver({ store: world.store })

    await expect(resolver.resolveMedia({ filename: "map.webp", hostname: "site-a.test" })).resolves.toEqual({
      code: MEDIA_UNAVAILABLE_CODE.ARTIFACT_INVALID,
      kind: "unavailable",
      status: 503,
    })
  })

  it("returns not-found for a filename absent from the release manifest", async () => {
    const world = await worldOf()
    const resolver = createMediaResolver({ store: world.store })

    await expect(
      resolver.resolveMedia({ filename: "never-uploaded.png", hostname: "site-a.test" }),
    ).resolves.toEqual({ kind: "not-found", status: 404 })
  })

  it("rejects path-traversal-shaped filenames as not-found without touching the store", async () => {
    const world = await worldOf()
    const resolver = createMediaResolver({ store: world.store })

    const traversal = await resolver.resolveMedia({ filename: "../manifest.json", hostname: "site-a.test" })
    expect(traversal).toEqual({ kind: "not-found", status: 404 })
    const empty = await resolver.resolveMedia({ filename: "", hostname: "site-a.test" })
    expect(empty).toEqual({ kind: "not-found", status: 404 })
  })

  it("returns unknown-host for a host absent from the routing manifest", async () => {
    const world = await worldOf()
    const resolver = createMediaResolver({ store: world.store })

    await expect(
      resolver.resolveMedia({ filename: "map.webp", hostname: "no-such-site.test" }),
    ).resolves.toEqual({ kind: "unknown-host", status: 404 })
  })

  it("caches the release state and stops re-reading the manifest within the TTL window", async () => {
    const world = await worldOf()
    let now = 0
    const resolver = createMediaResolver({ cache: { ttlMs: 10 }, clock: () => now, store: world.store })
    const manifestKey = `sites/site-a/releases/${world.release.releaseId}/manifest.json`

    await resolver.resolveMedia({ filename: "map.webp", hostname: "site-a.test" })
    await resolver.resolveMedia({ filename: "map.webp", hostname: "site-a.test" })
    expect(world.store.reads(manifestKey)).toBe(1)

    now = 11
    await resolver.resolveMedia({ filename: "map.webp", hostname: "site-a.test" })
    expect(world.store.reads(manifestKey)).toBe(2)
  })
})

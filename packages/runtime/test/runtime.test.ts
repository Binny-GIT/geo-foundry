import {
  articleListPageFixture,
  articlePageFixture,
  categoryPageFixture,
  notFoundPageFixture,
  type PageDocument,
  PageDocumentSchema,
  redirectPageFixture,
  tagPageFixture,
} from "@geo/schema"
import {
  CurrentPointerSchema,
  currentPointerKey,
  hashReleaseManifest,
  hashRoutingManifest,
  ReleaseManifestSchema,
  RoutingManifestPointerSchema,
  releaseArtifactKey,
  releaseManifestKey,
  routeIndexOf,
  routingManifestKey,
  serializeReleaseManifest,
  serializeRoutingManifest,
} from "@geo/schema/release/v1"
import { describe, expect, it } from "vitest"

import {
  createRuntime,
  RUNTIME_UNAVAILABLE_CODE,
  type RuntimeObject,
  type RuntimeObjectHead,
  type RuntimeObjectReader,
} from "../src/index.js"

const encoder = new TextEncoder()

type StoredObject = {
  readonly body: Uint8Array
  readonly contentType: string
  readonly etag: string
}

class MemoryObjectReader implements RuntimeObjectReader {
  readonly #objects = new Map<string, StoredObject>()
  readonly #reads = new Map<string, number>()
  readonly #heads = new Map<string, number>()
  readonly #failures = new Set<string>()
  #etag = 0

  put(key: string, body: Uint8Array, contentType = "application/json"): void {
    this.#etag += 1
    this.#objects.set(key, {
      body: new Uint8Array(body),
      contentType,
      etag: `"etag-${this.#etag}"`,
    })
  }

  failOnce(operation: "head" | "read", key: string): void {
    this.#failures.add(`${operation}\u0000${key}`)
  }

  reads(key: string): number {
    return this.#reads.get(key) ?? 0
  }

  heads(key: string): number {
    return this.#heads.get(key) ?? 0
  }

  async head(key: string): Promise<RuntimeObjectHead | null> {
    this.#heads.set(key, this.heads(key) + 1)
    this.#throwIfFailed("head", key)
    const object = this.#objects.get(key)
    return object === undefined
      ? null
      : { bytes: object.body.byteLength, contentType: object.contentType, etag: object.etag }
  }

  async read(key: string): Promise<RuntimeObject | null> {
    this.#reads.set(key, this.reads(key) + 1)
    this.#throwIfFailed("read", key)
    const object = this.#objects.get(key)
    return object === undefined
      ? null
      : {
          body: new Uint8Array(object.body),
          bytes: object.body.byteLength,
          contentType: object.contentType,
          etag: object.etag,
        }
  }

  #throwIfFailed(operation: "head" | "read", key: string): void {
    const failure = `${operation}\u0000${key}`
    if (this.#failures.delete(failure)) {
      throw new Error("simulated object storage failure")
    }
  }
}

const pageFixtureByType = {
  article: articlePageFixture,
  "article-list": articleListPageFixture,
  category: categoryPageFixture,
  redirect: redirectPageFixture,
  tag: tagPageFixture,
  "not-found": notFoundPageFixture,
} as const

const objectPathOf = (pathname: string): string => `pages${pathname}.json`

const jsonBody = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))

const sha256Of = async (body: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const documentOf = (
  pageType: keyof typeof pageFixtureByType,
  pathname: string,
  siteId: string,
  canonicalDomain: string,
): PageDocument => {
  const fixture = pageFixtureByType[pageType]
  return PageDocumentSchema.parse({
    ...fixture,
    identity: { ...fixture.identity, siteId },
    route: {
      ...fixture.route,
      canonicalUrl: `https://${canonicalDomain}${pathname}`,
      pathname,
    },
  })
}

type BuiltSiteRelease = {
  readonly pointerBody: Uint8Array
  readonly pointerKey: string
  readonly releaseId: string
  readonly siteId: string
}

const buildSiteRelease = async (input: {
  readonly articlePath?: string
  readonly canonicalDomain: string
  readonly releaseId: string
  readonly siteId: string
  readonly store: MemoryObjectReader
}): Promise<BuiltSiteRelease> => {
  const articlePath = input.articlePath ?? "/article"
  const pages = [
    documentOf("article", articlePath, input.siteId, input.canonicalDomain),
    documentOf("article-list", "/articles", input.siteId, input.canonicalDomain),
    documentOf("category", "/category", input.siteId, input.canonicalDomain),
    documentOf("tag", "/tag", input.siteId, input.canonicalDomain),
    documentOf("redirect", "/old", input.siteId, input.canonicalDomain),
    documentOf("not-found", "/not-found", input.siteId, input.canonicalDomain),
  ] as const
  const routes = routeIndexOf({
    canonicalDomain: input.canonicalDomain,
    routes: [
      {
        objectKey: objectPathOf(articlePath),
        pageType: "article",
        pathname: articlePath,
        status: "active",
      },
      {
        objectKey: objectPathOf("/articles"),
        pageType: "article-list",
        pathname: "/articles",
        status: "active",
      },
      {
        objectKey: objectPathOf("/category"),
        pageType: "category",
        pathname: "/category",
        status: "active",
      },
      { pathname: "/gone", status: "gone" },
      {
        objectKey: objectPathOf("/not-found"),
        pageType: "not-found",
        pathname: "/not-found",

        status: "not-found",
      },
      {
        objectKey: objectPathOf("/old"),
        pageType: "redirect",
        pathname: "/old",
        status: "redirect",
      },
      { objectKey: objectPathOf("/tag"), pageType: "tag", pathname: "/tag", status: "active" },
    ],
    schemaVersion: 1,
    siteId: input.siteId,
  })
  const artifacts = [
    ...pages.map((page) => ({
      body: jsonBody(page),
      contentType: "application/json",
      path: objectPathOf(page.route.pathname),
    })),
    { body: jsonBody(routes), contentType: "application/json", path: "routes.json" },
    {
      body: encoder.encode(
        `<urlset data-site="${input.siteId}" data-release="${input.releaseId}"/>`,
      ),
      contentType: "application/xml",
      path: "sitemap.xml",
    },
  ]
  const manifest = ReleaseManifestSchema.parse({
    compilerVersion: "1.0.0",
    createdAt: "2026-08-20T00:00:00.000Z",
    objects: await Promise.all(
      artifacts.map(async (artifact) => ({
        bytes: artifact.body.byteLength,
        contentType: artifact.contentType,
        path: artifact.path,
        sha256: await sha256Of(artifact.body),
      })),
    ),
    releaseId: input.releaseId,
    schemaVersion: 1,
    siteId: input.siteId,
    sourceVersionIds: ["source-001"],
  })
  for (const artifact of artifacts) {
    input.store.put(
      releaseArtifactKey(manifest.siteId, manifest.releaseId, artifact.path as never),
      artifact.body,
      artifact.contentType,
    )
  }
  input.store.put(
    releaseManifestKey(manifest.siteId, manifest.releaseId),
    serializeReleaseManifest(manifest),
  )
  const pointer = CurrentPointerSchema.parse({
    actor: { actorId: "runtime-fixture", kind: "service" },
    manifestSha256: await hashReleaseManifest(manifest),
    releaseId: manifest.releaseId,
    schemaVersion: 1,
    siteId: manifest.siteId,
    updatedAt: "2026-08-20T00:00:00.000Z",
  })
  return {
    pointerBody: jsonBody(pointer),
    pointerKey: currentPointerKey(manifest.siteId),
    releaseId: manifest.releaseId,
    siteId: manifest.siteId,
  }
}

const installRouting = async (
  store: MemoryObjectReader,
  routingId: string,
  hosts: readonly { readonly canonical: boolean; readonly host: string; readonly siteId: string }[],
): Promise<void> => {
  const manifest = { hosts, schemaVersion: 1 as const }
  const pointer = RoutingManifestPointerSchema.parse({
    manifestSha256: await hashRoutingManifest(manifest),
    routingId,
    updatedAt: "2026-08-20T00:00:00.000Z",
  })
  store.put(routingManifestKey(pointer.routingId), serializeRoutingManifest(manifest))
  store.put("routing/channels/current.json", jsonBody(pointer))
}

type RuntimeWorld = {
  readonly aV1: BuiltSiteRelease
  readonly bV1: BuiltSiteRelease
  readonly store: MemoryObjectReader
}

const worldOf = async (): Promise<RuntimeWorld> => {
  const store = new MemoryObjectReader()
  const aV1 = await buildSiteRelease({
    canonicalDomain: "site-a.test",
    releaseId: "release-a-v1",
    siteId: "site-a",
    store,
  })
  const bV1 = await buildSiteRelease({
    canonicalDomain: "site-b.test",
    releaseId: "release-b-v1",
    siteId: "site-b",
    store,
  })
  store.put(aV1.pointerKey, aV1.pointerBody)
  store.put(bV1.pointerKey, bV1.pointerBody)
  await installRouting(store, "routing-v1", [
    { canonical: true, host: "site-a.test", siteId: "site-a" },
    { canonical: false, host: "www.site-a.test", siteId: "site-a" },
    { canonical: true, host: "site-b.test", siteId: "site-b" },
  ])
  return { aV1, bV1, store }
}

describe("runtime resolution", () => {
  it("resolves active, redirect, gone, not-found, unknown-host, aliases, and isolated sites", async () => {
    const world = await worldOf()
    const runtime = createRuntime({ store: world.store })

    await expect(
      runtime.resolve({ hostname: "SITE-A.TEST:443", pathname: "/article" }),
    ).resolves.toMatchObject({
      kind: "page",
      siteId: "site-a",
      status: 200,
    })
    await expect(
      runtime.resolve({ hostname: "www.site-a.test", pathname: "/articles" }),
    ).resolves.toMatchObject({
      document: { pageType: "article-list" },
      kind: "page",
      siteId: "site-a",
    })
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/category" }),
    ).resolves.toMatchObject({
      document: { pageType: "category" },
      kind: "page",
    })
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/tag" }),
    ).resolves.toMatchObject({
      document: { pageType: "tag" },
      kind: "page",
    })
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/old" }),
    ).resolves.toMatchObject({
      kind: "redirect",
      status: 301,
      targetUrl: "https://site-a.test/guides/article",
    })
    await expect(runtime.resolve({ hostname: "site-a.test", pathname: "/gone" })).resolves.toEqual({
      kind: "gone",
      releaseId: "release-a-v1",
      siteId: "site-a",
      status: 410,
    })
    expect(world.store.reads(`sites/site-a/releases/${world.aV1.releaseId}/pages/gone.json`)).toBe(
      0,
    )
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/does-not-exist" }),
    ).resolves.toMatchObject({
      document: { pageType: "not-found" },
      kind: "not-found",
      status: 404,
    })
    await expect(
      runtime.resolve({ hostname: "unknown.test", pathname: "/article" }),
    ).resolves.toEqual({
      kind: "unknown-host",
      status: 404,
    })
    await expect(
      runtime.resolve({ hostname: "site-b.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      kind: "page",
      siteId: "site-b",
    })
  })

  it("serves manifest-verified sitemaps and refreshes them when the Site pointer changes", async () => {
    const world = await worldOf()
    let now = 0
    const runtime = createRuntime({ cache: { ttlMs: 10 }, clock: () => now, store: world.store })
    const sitemapV1 = `sites/site-a/releases/${world.aV1.releaseId}/sitemap.xml`

    const first = await runtime.resolveSitemap({ hostname: "www.site-a.test" })
    expect(first).toMatchObject({ kind: "sitemap", releaseId: "release-a-v1", status: 200 })
    if (first.kind !== "sitemap") {
      throw new Error("expected sitemap")
    }
    expect(new TextDecoder().decode(first.body)).toContain('data-release="release-a-v1"')
    await runtime.resolveSitemap({ hostname: "site-a.test" })
    expect(world.store.reads(sitemapV1)).toBe(1)

    const aV2 = await buildSiteRelease({
      canonicalDomain: "site-a.test",
      releaseId: "release-a-v2",
      siteId: "site-a",
      store: world.store,
    })
    world.store.put(aV2.pointerKey, aV2.pointerBody)
    const second = await runtime.resolveSitemap({ hostname: "site-a.test" })
    expect(second).toMatchObject({ kind: "sitemap", releaseId: "release-a-v2", status: 200 })

    const sitemapV2 = `sites/site-a/releases/${aV2.releaseId}/sitemap.xml`
    const original = await world.store.read(sitemapV2)
    if (original === null) {
      throw new Error("fixture sitemap missing")
    }
    world.store.put(sitemapV2, encoder.encode("<tampered/>"), "application/xml")
    now = 11
    await expect(runtime.resolveSitemap({ hostname: "site-a.test" })).resolves.toEqual({
      code: RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID,
      kind: "unavailable",
      status: 503,
    })
    world.store.put(sitemapV2, original.body, "application/xml")
  })

  it("rejects malformed/tampered artifacts and recovers after transient storage failure", async () => {
    const world = await worldOf()
    const pageKey = `sites/site-a/releases/${world.aV1.releaseId}/pages/article.json`
    const original = await world.store.read(pageKey)
    if (original === null) {
      throw new Error("fixture page missing")
    }
    world.store.put(pageKey, encoder.encode("{}"))
    const runtime = createRuntime({ store: world.store })

    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/article" }),
    ).resolves.toEqual({
      code: RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID,
      kind: "unavailable",
      status: 503,
    })

    world.store.put(pageKey, original.body)
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      kind: "page",
      status: 200,
    })

    world.store.failOnce("read", "routing/channels/current.json")
    const unstableRuntime = createRuntime({ store: world.store })
    await expect(
      unstableRuntime.resolve({ hostname: "site-a.test", pathname: "/article" }),
    ).resolves.toEqual({
      code: RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE,
      kind: "unavailable",
      status: 503,
    })
    await expect(
      unstableRuntime.resolve({ hostname: "site-a.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      kind: "page",
      status: 200,
    })
  })

  it("invalidates routing and selected-site state when their pointer ETags change", async () => {
    const world = await worldOf()
    const runtime = createRuntime({ store: world.store })
    await expect(
      runtime.resolve({ hostname: "www.site-a.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      siteId: "site-a",
    })

    await installRouting(world.store, "routing-v2", [
      { canonical: true, host: "site-a.test", siteId: "site-a" },
      { canonical: true, host: "site-b.test", siteId: "site-b" },
      { canonical: false, host: "www.site-a.test", siteId: "site-b" },
    ])
    await expect(
      runtime.resolve({ hostname: "www.site-a.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      siteId: "site-b",
    })

    const aV2 = await buildSiteRelease({
      canonicalDomain: "site-a.test",
      releaseId: "release-a-v2",
      siteId: "site-a",
      store: world.store,
    })
    world.store.put(aV2.pointerKey, aV2.pointerBody)
    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/does-not-exist" }),
    ).resolves.toMatchObject({
      kind: "not-found",
      releaseId: "release-a-v2",
    })
  })

  it("does not retain a stale not-found response after a site pointer publishes that pathname", async () => {
    const world = await worldOf()
    const runtime = createRuntime({ store: world.store })

    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/newly-published" }),
    ).resolves.toMatchObject({
      kind: "not-found",
      releaseId: "release-a-v1",
      status: 404,
    })

    const aV2 = await buildSiteRelease({
      articlePath: "/newly-published",
      canonicalDomain: "site-a.test",
      releaseId: "release-a-v2",
      siteId: "site-a",
      store: world.store,
    })
    world.store.put(aV2.pointerKey, aV2.pointerBody)

    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/newly-published" }),
    ).resolves.toMatchObject({
      kind: "page",
      releaseId: "release-a-v2",
      status: 200,
    })
    await expect(
      runtime.resolve({ hostname: "site-b.test", pathname: "/article" }),
    ).resolves.toMatchObject({
      kind: "page",
      releaseId: "release-b-v1",
      siteId: "site-b",
      status: 200,
    })
  })

  it("keeps verified objects in TTL L1 cache and evicts least-recently-used pages", async () => {
    const world = await worldOf()
    let now = 0
    const runtime = createRuntime({
      cache: { maxEntries: 1, ttlMs: 10 },
      clock: () => now,
      store: world.store,
    })
    const articleKey = `sites/site-a/releases/${world.aV1.releaseId}/pages/article.json`

    await runtime.resolve({ hostname: "site-a.test", pathname: "/article" })
    await runtime.resolve({ hostname: "site-a.test", pathname: "/article" })
    expect(world.store.reads(articleKey)).toBe(1)

    await runtime.resolve({ hostname: "site-a.test", pathname: "/articles" })
    await runtime.resolve({ hostname: "site-a.test", pathname: "/article" })
    expect(world.store.reads(articleKey)).toBe(2)

    now = 11
    await runtime.resolve({ hostname: "site-a.test", pathname: "/article" })
    expect(world.store.reads(articleKey)).toBe(3)
  })

  it("returns stable request and routing failures without serving unverified bytes", async () => {
    const world = await worldOf()
    const runtime = createRuntime({ store: world.store })

    await expect(
      runtime.resolve({ hostname: "site-a.test", pathname: "/article?x=1" }),
    ).resolves.toEqual({
      code: RUNTIME_UNAVAILABLE_CODE.REQUEST_INVALID,
      kind: "unavailable",
      status: 503,
    })

    world.store.put(routingManifestKey("routing-v1" as never), encoder.encode('{"hosts":[]}'))
    const invalidRuntime = createRuntime({ store: world.store })
    await expect(
      invalidRuntime.resolve({ hostname: "site-a.test", pathname: "/article" }),
    ).resolves.toEqual({
      code: RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID,
      kind: "unavailable",
      status: 503,
    })
  })
})

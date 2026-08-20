import {
  type ArtifactStoreKey,
  AuditActorSchema,
  CanonicalTimestampSchema,
  type ContentType,
  type CurrentPointer,
  createCurrentPointer,
  currentPointerKey,
  type ETag,
  releaseArtifactKey,
  releaseManifestKey,
  type releasePrefix,
  verifyManifest,
} from "@geo/schema/release/v1"
import { describe, expect, it } from "vitest"

import {
  type ArtifactObject,
  type ArtifactObjectHead,
  type ArtifactStore,
  ROLLBACK_ERROR_CODE,
  rollbackRelease,
  StalePointerEtagError,
  sha256Of,
} from "../src/index.js"

type StoredObject = {
  body: Uint8Array
  contentType: ContentType
  etag: ETag
}

const actor = AuditActorSchema.parse({ actorId: "publisher-service", kind: "service" })
const siteId = "site-a"
const releaseId = (suffix: string) => `release-${suffix}`
const timestamp = CanonicalTimestampSchema.parse("2026-08-20T12:00:00.000Z")

const clone = (body: Uint8Array): Uint8Array => new Uint8Array(body)

class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, StoredObject>()
  casCalls = 0
  staleOnNextCas = false
  #version = 0

  async createIfAbsent(): Promise<ArtifactObjectHead> {
    throw new Error("rollback must not create immutable objects")
  }

  async createCurrentPointer(): Promise<ArtifactObjectHead> {
    throw new Error("rollback must not create pointers")
  }

  async read({ key }: { readonly key: ArtifactStoreKey }): Promise<ArtifactObject> {
    const stored = this.objects.get(key)
    if (stored === undefined) {
      throw new Error(`missing ${key}`)
    }
    return this.objectOf(key, stored)
  }

  async list({
    prefix,
  }: {
    readonly prefix: ReturnType<typeof releasePrefix>
  }): Promise<readonly ArtifactObjectHead[]> {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, stored]) => this.headOf(key as ArtifactStoreKey, stored))
  }

  async head({ key }: { readonly key: ArtifactStoreKey }): Promise<ArtifactObjectHead | null> {
    const stored = this.objects.get(key)
    return stored === undefined ? null : this.headOf(key, stored)
  }

  async compareAndSwapCurrentPointer({
    expectedEtag,
    pointer,
  }: {
    readonly expectedEtag: ETag
    readonly pointer: CurrentPointer
  }): Promise<ArtifactObjectHead> {
    this.casCalls += 1
    const key = currentPointerKey(pointer.siteId)
    const existing = this.objects.get(key)
    if (existing === undefined || existing.etag !== expectedEtag || this.staleOnNextCas) {
      this.staleOnNextCas = false
      throw new StalePointerEtagError(expectedEtag, existing?.etag ?? expectedEtag)
    }
    const body = new TextEncoder().encode(JSON.stringify(pointer))
    const next: StoredObject = {
      body,
      contentType: "application/json" as ContentType,
      etag: this.etag(),
    }
    this.objects.set(key, next)
    return this.headOf(key, next)
  }

  async seedRelease(release: string, body = `release ${release}`): Promise<string> {
    const page = new TextEncoder().encode(body)
    const manifest = {
      compilerVersion: "1.0.0",
      createdAt: timestamp,
      objects: [
        {
          bytes: page.byteLength,
          contentType: "application/json",
          path: "pages/index.json",
          sha256: sha256Of(page),
        },
      ],
      releaseId: release,
      schemaVersion: 1,
      siteId,
      sourceVersionIds: ["source-one"],
    }
    const verified = await verifyManifest(manifest)
    this.seed(
      releaseArtifactKey(siteId as never, release as never, "pages/index.json" as never),
      page,
      "application/json" as ContentType,
    )
    this.seed(
      releaseManifestKey(siteId as never, release as never),
      new TextEncoder().encode(JSON.stringify(manifest)),
      "application/json" as ContentType,
    )
    return verified.manifestSha256
  }

  async pointTo(release: string, manifestSha256: string): Promise<void> {
    const verified = await verifyManifest({
      compilerVersion: "1.0.0",
      createdAt: timestamp,
      objects: [
        {
          bytes: 1,
          contentType: "application/json",
          path: "pages/index.json",
          sha256: "a".repeat(64),
        },
      ],
      releaseId: release,
      schemaVersion: 1,
      siteId,
      sourceVersionIds: ["source-one"],
    })
    const pointer = createCurrentPointer({ actor, release: verified, updatedAt: timestamp })
    const body = new TextEncoder().encode(JSON.stringify({ ...pointer, manifestSha256 }))
    this.seed(currentPointerKey(siteId as never), body, "application/json" as ContentType)
  }

  seed(key: ArtifactStoreKey, body: Uint8Array, contentType: ContentType): void {
    this.objects.set(key, { body: clone(body), contentType, etag: this.etag() })
  }

  #etag(): ETag {
    this.#version += 1
    return `"etag-${this.#version}"` as ETag
  }

  etag(): ETag {
    return this.#etag()
  }

  private objectOf(key: ArtifactStoreKey, stored: StoredObject): ArtifactObject {
    return { ...this.headOf(key, stored), body: clone(stored.body) }
  }

  private headOf(key: ArtifactStoreKey, stored: StoredObject): ArtifactObjectHead {
    return {
      bytes: stored.body.byteLength,
      contentType: stored.contentType,
      etag: stored.etag,
      key,
      sha256: sha256Of(stored.body) as never,
    }
  }
}

const setup = async () => {
  const store = new MemoryArtifactStore()
  const v1Hash = await store.seedRelease(releaseId("v1"), "version one")
  const v2Hash = await store.seedRelease(releaseId("v2"), "version two")
  await store.pointTo(releaseId("v2"), v2Hash)
  return { store, v1Hash, v2Hash }
}

describe("remote immutable release rollback", () => {
  it("verifies v1 and atomically repoints v2 back to byte-identical v1", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    const v1Key = releaseArtifactKey(
      siteId as never,
      releaseId("v1") as never,
      "pages/index.json" as never,
    )
    const before = await store.read({ key: v1Key })

    const result = await rollbackRelease({
      actor,
      expectedCurrentManifestSha256: v2Hash,
      expectedCurrentReleaseId: releaseId("v2"),
      expectedManifestSha256: v1Hash,
      recordedAt: timestamp,
      releaseId: releaseId("v1"),
      siteId,
      store,
    })

    expect(result.pointer).toMatchObject({
      manifestSha256: v1Hash,
      releaseId: releaseId("v1"),
      siteId,
    })
    expect(result.receipt).toMatchObject({
      action: "rollback",
      fromReleaseId: releaseId("v2"),
      releaseId: releaseId("v1"),
    })
    expect(await store.read({ key: v1Key })).toEqual(before)
    expect(store.casCalls).toBe(1)
  })

  it("returns a stable no-op receipt when the requested target is already current", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    await rollbackRelease({
      actor,
      expectedCurrentManifestSha256: v2Hash,
      expectedCurrentReleaseId: releaseId("v2"),
      expectedManifestSha256: v1Hash,
      recordedAt: timestamp,
      releaseId: releaseId("v1"),
      siteId,
      store,
    })
    const replay = await rollbackRelease({
      actor,
      expectedCurrentManifestSha256: v2Hash,
      expectedCurrentReleaseId: releaseId("v2"),
      expectedManifestSha256: v1Hash,
      recordedAt: timestamp,
      releaseId: releaseId("v1"),
      siteId,
      store,
    })

    expect(replay.receipt.oldEtag).toBe(replay.receipt.newEtag)
    expect(store.casCalls).toBe(1)
  })

  it("refuses a tampered target object before pointer compare-and-swap", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    store.seed(
      releaseArtifactKey(siteId as never, releaseId("v1") as never, "pages/index.json" as never),
      new TextEncoder().encode("tampered"),
      "application/json" as ContentType,
    )

    await expect(
      rollbackRelease({
        actor,
        expectedCurrentManifestSha256: v2Hash,
        expectedCurrentReleaseId: releaseId("v2"),
        expectedManifestSha256: v1Hash,
        recordedAt: timestamp,
        releaseId: releaseId("v1"),
        siteId,
        store,
      }),
    ).rejects.toMatchObject({ code: ROLLBACK_ERROR_CODE.RELEASE_OBJECT_BYTES_MISMATCH })
    expect(store.casCalls).toBe(0)
  })

  it("refuses cross-site manifest selection before pointer compare-and-swap", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    const manifestKey = releaseManifestKey(siteId as never, releaseId("v1") as never)
    const stored = await store.read({ key: manifestKey })
    const manifest = JSON.parse(new TextDecoder().decode(stored.body))
    store.seed(
      manifestKey,
      new TextEncoder().encode(JSON.stringify({ ...manifest, siteId: "site-b" })),
      "application/json" as ContentType,
    )

    await expect(
      rollbackRelease({
        actor,
        expectedCurrentManifestSha256: v2Hash,
        expectedCurrentReleaseId: releaseId("v2"),
        expectedManifestSha256: v1Hash,
        recordedAt: timestamp,
        releaseId: releaseId("v1"),
        siteId,
        store,
      }),
    ).rejects.toMatchObject({ code: ROLLBACK_ERROR_CODE.RELEASE_SITE_MISMATCH })
    expect(store.casCalls).toBe(0)
  })

  it("does not overwrite a concurrent pointer winner", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    store.staleOnNextCas = true

    await expect(
      rollbackRelease({
        actor,
        expectedCurrentManifestSha256: v2Hash,
        expectedCurrentReleaseId: releaseId("v2"),
        expectedManifestSha256: v1Hash,
        recordedAt: timestamp,
        releaseId: releaseId("v1"),
        siteId,
        store,
      }),
    ).rejects.toBeInstanceOf(StalePointerEtagError)
    expect(store.casCalls).toBe(1)
  })

  it("refuses a rollback approved against an older current pointer", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    const v3Hash = await store.seedRelease(releaseId("v3"), "version three")
    await store.pointTo(releaseId("v3"), v3Hash)

    await expect(
      rollbackRelease({
        actor,
        expectedCurrentManifestSha256: v2Hash,
        expectedCurrentReleaseId: releaseId("v2"),
        expectedManifestSha256: v1Hash,
        recordedAt: timestamp,
        releaseId: releaseId("v1"),
        siteId,
        store,
      }),
    ).rejects.toMatchObject({ code: ROLLBACK_ERROR_CODE.EXPECTED_CURRENT_MISMATCH })
    expect(store.casCalls).toBe(0)
  })

  it("rejects unlisted target objects", async () => {
    const { store, v1Hash, v2Hash } = await setup()
    store.seed(
      releaseArtifactKey(siteId as never, releaseId("v1") as never, "pages/extra.json" as never),
      new TextEncoder().encode("extra"),
      "application/json" as ContentType,
    )

    await expect(
      rollbackRelease({
        actor,
        expectedCurrentManifestSha256: v2Hash,
        expectedCurrentReleaseId: releaseId("v2"),
        expectedManifestSha256: v1Hash,
        recordedAt: timestamp,
        releaseId: releaseId("v1"),
        siteId,
        store,
      }),
    ).rejects.toMatchObject({ code: ROLLBACK_ERROR_CODE.RELEASE_EXTRA_OBJECT })
    expect(store.casCalls).toBe(0)
  })
})

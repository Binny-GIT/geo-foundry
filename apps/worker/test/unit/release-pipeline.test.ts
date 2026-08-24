import type { CompileOutput } from "@geo/compiler"
import {
  type ArtifactObject,
  type ArtifactObjectHead,
  type ArtifactStore,
  type CurrentPointer,
  type ETag,
  planRelease,
  type ReleaseBuildInput,
  type ReleaseObjectKey,
  type Sha256,
} from "@geo/publisher"
import { currentPointerKey, routeIndexOf, verifyManifest } from "@geo/schema/release/v1"
import { describe, expect, it } from "vitest"

import {
  type PlannedSiteRelease,
  publishPlannedRelease,
  releaseIdentityFor,
} from "../../src/processors/release-pipeline.js"

describe("release identity", () => {
  it("mints a fresh deterministic release id when the edition has no compiled release yet", () => {
    const releaseId = releaseIdentityFor("op-approve-and-compile", {
      compiledRelease: null,
      workflowStatus: "approved",
    })
    expect(releaseId).toBe(releaseIdentityFor("op-approve-and-compile", {
      compiledRelease: null,
      workflowStatus: "approved",
    }))
    expect(releaseId).not.toBe(
      releaseIdentityFor("op-different-operation", {
        compiledRelease: null,
        workflowStatus: "approved",
      }),
    )
  })

  it("reuses the persisted compiled release instead of minting a new one from the publish operation", () => {
    const releaseId = releaseIdentityFor("op-publish-gate", {
      compiledRelease: "rel-already-compiled-evidence",
      workflowStatus: "compiled",
    })
    expect(releaseId).toBe("rel-already-compiled-evidence")
  })
})

type StoredObject = {
  readonly body: Uint8Array
  readonly contentType: string
  readonly etag: ETag
  readonly key: string
  readonly sha256: Sha256
}

class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, StoredObject>()
  #version = 0

  async createIfAbsent(request: {
    readonly body: Uint8Array
    readonly contentType: string
    readonly key: ReleaseObjectKey
    readonly sha256: Sha256
  }): Promise<ArtifactObjectHead> {
    if (this.objects.has(request.key)) {
      const error = new Error("conditional object exists")
      error.name = "PreconditionFailed"
      throw error
    }
    const stored = this.store(request.key, request.body, request.contentType, request.sha256)
    return this.headOf(stored)
  }

  async createCurrentPointer({
    pointer,
  }: {
    readonly pointer: CurrentPointer
  }): Promise<ArtifactObjectHead> {
    const key = currentPointerKey(pointer.siteId)
    if (this.objects.has(key)) {
      const error = new Error("conditional pointer exists")
      error.name = "PreconditionFailed"
      throw error
    }
    const body = new TextEncoder().encode(JSON.stringify(pointer))
    const stored = this.store(key, body, "application/json", "0".repeat(64) as Sha256)
    return this.headOf(stored)
  }

  async compareAndSwapCurrentPointer({
    expectedEtag,
    pointer,
  }: {
    readonly expectedEtag: ETag
    readonly pointer: CurrentPointer
  }): Promise<ArtifactObjectHead> {
    const key = currentPointerKey(pointer.siteId)
    const current = this.objects.get(key)
    if (current === undefined || current.etag !== expectedEtag) {
      throw new Error("unexpected stale pointer")
    }
    const body = new TextEncoder().encode(JSON.stringify(pointer))
    const stored = this.store(key, body, "application/json", "0".repeat(64) as Sha256)
    return this.headOf(stored)
  }

  async head({ key }: { readonly key: string }): Promise<ArtifactObjectHead | null> {
    const stored = this.objects.get(key)
    return stored === undefined ? null : this.headOf(stored)
  }

  async list(): Promise<readonly ArtifactObjectHead[]> {
    return [...this.objects.values()].map((stored) => this.headOf(stored))
  }

  async read({ key }: { readonly key: string }): Promise<ArtifactObject> {
    const stored = this.objects.get(key)
    if (stored === undefined) {
      throw new Error(`missing ${key}`)
    }
    return { ...this.headOf(stored), body: new Uint8Array(stored.body) }
  }

  private headOf(stored: StoredObject): ArtifactObjectHead {
    return {
      bytes: stored.body.byteLength,
      contentType: stored.contentType as never,
      etag: stored.etag,
      key: stored.key as never,
      sha256: stored.sha256,
    }
  }

  private store(key: string, body: Uint8Array, contentType: string, sha256: Sha256): StoredObject {
    this.#version += 1
    const stored = {
      body: new Uint8Array(body),
      contentType,
      etag: `"etag-${this.#version}"` as ETag,
      key,
      sha256,
    }
    this.objects.set(key, stored)
    return stored
  }
}

const compileOutput = (): CompileOutput => ({
  compilerVersion: "1.0.0",
  documents: [
    {
      canonical: '{"pageType":"article","pathname":"/article"}',
      pageType: "article",
      pathname: "/article",
      sha256: "a".repeat(64),
    },
    {
      canonical: '{"pageType":"not-found","pathname":"/not-found"}',
      pageType: "not-found",
      pathname: "/not-found",
      sha256: "b".repeat(64),
    },
  ],
  manifestSha256: "c".repeat(64),
  routeIndex: routeIndexOf({
    canonicalDomain: "site-a.test",
    routes: [
      {
        objectKey: "pages/article.json",
        pageType: "article",
        pathname: "/article",
        status: "active",
      },
      {
        objectKey: "pages/not-found.json",
        pageType: "not-found",
        pathname: "/not-found",
        status: "not-found",
      },
    ],
    schemaVersion: 1,
    siteId: "site-a",
  }),
  sitemap: "<urlset/>",
})

const plannedRelease = async (): Promise<PlannedSiteRelease> => {
  const buildInput: ReleaseBuildInput = {
    compileOutput: compileOutput(),
    createdAt: "2026-08-21T00:00:00.000Z",
    releaseId: "release-worker-replay",
    routingManifest: {
      hosts: [{ canonical: true, host: "site-a.test", siteId: "site-a" }],
      schemaVersion: 1,
    },
    siteId: "site-a",
    sourceVersionIds: ["edition-1-rev-1"],
  }
  const plan = planRelease(buildInput)
  const verifiedManifest = await verifyManifest(plan.manifest)
  return {
    buildInput,
    compileOutput: buildInput.compileOutput,
    manifestSha256: verifiedManifest.manifestSha256,
    objectCount: plan.manifest.objects.length,
    plan,
    releaseId: plan.manifest.releaseId,
    verifiedManifest,
  }
}

describe("publish replay after control-plane failure", () => {
  it("replays a CAS-complete release without pointer churn after registry recording fails", async () => {
    const store = new MemoryArtifactStore()
    const planned = await plannedRelease()
    let recordAttempts = 0
    const context = {
      client: {
        getEditionInput: async () => ({ siteId: 1 }),
        recordPublishedRelease: async () => {
          recordAttempts += 1
          if (recordAttempts === 1) {
            throw new Error("simulated registry outage after pointer CAS")
          }
        },
      },
    } as never
    const input = {
      editionId: 1,
      operationId: "11111111-2222-3333-4444-555555555555",
      planned,
      store,
    }

    await expect(publishPlannedRelease(context, input)).rejects.toThrow(
      "simulated registry outage after pointer CAS",
    )
    const pointerKey = currentPointerKey("site-a" as never)
    const afterFailure = await store.head({ key: pointerKey })
    expect(afterFailure).not.toBeNull()

    const receipt = await publishPlannedRelease(context, input)
    const afterReplay = await store.head({ key: pointerKey })

    expect(afterReplay?.etag).toBe(afterFailure?.etag)
    expect(receipt.releaseId).toBe("release-worker-replay")
    expect(recordAttempts).toBe(2)
  })
})

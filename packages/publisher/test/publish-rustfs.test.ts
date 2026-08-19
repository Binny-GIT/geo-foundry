import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

import { createCurrentPointer, verifyManifest, type AuditActor } from "@geo/schema/release/v1"

import {
  createS3ArtifactStore,
  PUBLISH_ERROR_CODE,
  planRelease,
  publishRelease,
  StalePointerEtagError,
  type PlannedRelease,
  type ReleaseBuildInput,
} from "../src/index.js"
import type { CompileOutput } from "@geo/compiler"

const envFile = new URL("../../../.test/rustfs-test.env", import.meta.url)
const hasRustfsEnv = (() => {
  try {
    readFileSync(envFile)
    return true
  } catch {
    return false
  }
})()

const env = (() => {
  const lines = readFileSync(envFile, "utf8")
  return Object.fromEntries(
    lines
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )
})()

const RUN = Date.now()
const BUCKET = "geo-foundry"
const SITE = `t29site${RUN}`
const RELEASE = (suffix: string) => `t29r${RUN}${suffix}`

const client = new S3Client({
  credentials: {
    accessKeyId: env["GEO_FOUNDRY_S3_ACCESS_KEY"] ?? "",
    secretAccessKey: env["GEO_FOUNDRY_S3_SECRET_KEY"] ?? "",
  },
  endpoint: `http://127.0.0.1:${env["GEO_FOUNDRY_S3_PORT"]}`,
  forcePathStyle: true,
  region: "rustfs",
})

const actor: AuditActor = { actorId: "actor-service-1" as never, kind: "service" }

const compileOutput = (): CompileOutput => ({
  compilerVersion: "1.0.0",
  documents: [
    {
      canonical: '{"pageType":"article","pathname":"/a"}',
      pageType: "article",
      pathname: "/a",
      sha256: "a".repeat(64),
    },
  ],
  manifestSha256: "b".repeat(64),
  routeIndex: {
    canonicalDomain: "site-a.test",
    routes: [{ objectKey: "pages/a.json", pageType: "article", pathname: "/a", status: "active" }],
    schemaVersion: 1,
    siteId: SITE,
  },
  sitemap: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
})

const inputOf = (releaseSuffix: string): ReleaseBuildInput => ({
  compileOutput: compileOutput(),
  createdAt: "2026-08-19T12:00:00.000Z",
  releaseId: RELEASE(releaseSuffix),
  routingManifest: {
    hosts: [{ canonical: true, host: `${SITE}.test`, siteId: SITE }],
    schemaVersion: 1,
  },
  siteId: SITE,
  sourceVersionIds: ["edition-1-version-1"],
})

const cleanupRunPrefix = async (): Promise<void> => {
  let token: string | undefined
  const objects: { Key: string }[] = []
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: token,
        Prefix: `objects/sites/${SITE}/`,
      }),
    )
    objects.push(
      ...(listed.Contents ?? [])
        .map((object) => ({ Key: object.Key ?? "" }))
        .filter((o) => o.Key !== ""),
    )
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token !== undefined)
  if (objects.length > 0) {
    await client.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }))
  }
}

describe.skipIf(!hasRustfsEnv)("publish against shared RustFS", () => {
  let store: ReturnType<typeof createS3ArtifactStore>

  beforeAll(() => {
    store = createS3ArtifactStore({
      bucket: BUCKET,
      client,
      clientConfig: {},
      keyPrefix: "objects",
    })
  })

  afterAll(async () => {
    await cleanupRunPrefix().catch(() => undefined)
  })

  it("conditionally creates objects, uploads the manifest last, and switches the pointer", async () => {
    const plan: PlannedRelease = planRelease(inputOf("-a"))
    const verified = await verifyManifest(plan.manifest)
    const result = await publishRelease({ actor, planned: plan, store, verifiedManifest: verified })

    expect(result.receipt).toMatchObject({
      action: "publish",
      oldEtag: null,
      releaseId: RELEASE("-a"),
      siteId: SITE,
    })
    expect(result.receipt.manifestSha256).toBe(verified.manifestSha256)
    expect(result.pointer.releaseId).toBe(RELEASE("-a"))

    const manifestObject = await store.read({
      key: `sites/${SITE}/releases/${RELEASE("-a")}/manifest.json` as never,
    })
    expect(manifestObject.body.byteLength).toBeGreaterThan(0)
  })

  it("replays an exact publish with an identical receipt and no pointer churn", async () => {
    const plan = planRelease(inputOf("-a"))
    const verified = await verifyManifest(plan.manifest)
    const first = await publishRelease({ actor, planned: plan, store, verifiedManifest: verified })
    const second = await publishRelease({ actor, planned: plan, store, verifiedManifest: verified })
    expect(second.receipt).toEqual(first.receipt)
    expect(second.etag).toBe(first.etag)
  })

  it("rejects an object that already exists with different content", async () => {
    const plan = planRelease(inputOf("-conflict"))
    const verified = await verifyManifest(plan.manifest)
    const key = `sites/${SITE}/releases/${RELEASE("-conflict")}/routes.json` as never
    await store.createIfAbsent({
      body: new TextEncoder().encode("tampered"),
      condition: "if-none-match-star",
      contentType: "application/json" as never,
      key,
      sha256: "c".repeat(64) as never,
    })
    await expect(
      publishRelease({ actor, planned: plan, store, verifiedManifest: verified }),
    ).rejects.toMatchObject({ code: PUBLISH_ERROR_CODE.OBJECT_EXISTS_WITH_DIFFERENT_CONTENT })
  })

  it("publishes v2 via compare-and-swap and yields exactly one winner under concurrency", async () => {
    const v2 = planRelease(inputOf("-v2"))
    const v3 = planRelease(inputOf("-v3"))
    const verified2 = await verifyManifest(v2.manifest)
    const verified3 = await verifyManifest(v3.manifest)
    await publishRelease({
      actor,
      planned: planRelease(inputOf("-a")),
      store,
      verifiedManifest: await verifyManifest(planRelease(inputOf("-a")).manifest),
    }).catch(() => undefined)

    const results = await Promise.allSettled([
      publishRelease({ actor, planned: v2, store, verifiedManifest: verified2 }),
      publishRelease({ actor, planned: v3, store, verifiedManifest: verified3 }),
    ])
    const fulfilled = results.filter((entry) => entry.status === "fulfilled")
    const rejected = results.filter((entry) => entry.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(StalePointerEtagError)

    const winner = fulfilled[0]
    if (winner === undefined || winner.status !== "fulfilled") {
      throw new Error("unreachable")
    }
    expect([RELEASE("-v2"), RELEASE("-v3")]).toContain(winner.value.pointer.releaseId)
    expect(winner.value.receipt.oldEtag).not.toBeNull()
  })

  it("swaps the pointer through the branded createCurrentPointer path on a fresh site", async () => {
    const plan = planRelease(inputOf("-fresh"))
    const verified = await verifyManifest(plan.manifest)
    const pointer = createCurrentPointer({
      actor,
      release: verified,
      updatedAt: plan.manifest.createdAt,
    })
    expect(pointer.releaseId).toBe(RELEASE("-fresh"))
    const result = await publishRelease({ actor, planned: plan, store, verifiedManifest: verified })
    expect(result.pointer.siteId).toBe(SITE)
  })
})

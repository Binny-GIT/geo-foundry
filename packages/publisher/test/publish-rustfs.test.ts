import { readFileSync } from "node:fs"
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import type { CompileOutput } from "@geo/compiler"

import {
  type AuditActor,
  createCurrentPointer,
  hashRoutingManifest,
  routeIndexOf,
  verifyManifest,
} from "@geo/schema/release/v1"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createS3ArtifactStore,
  createS3RoutingStore,
  type PlannedRelease,
  PUBLISH_ERROR_CODE,
  planRelease,
  publishRelease,
  publishRoutingManifest,
  type ReleaseBuildInput,
  ROUTING_PUBLISH_ERROR_CODE,
  rollbackRelease,
  type S3RoutingStore,
  StalePointerEtagError,
} from "../src/index.js"

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
  if (!hasRustfsEnv) {
    return {} as Record<string, string>
  }
  const lines = readFileSync(envFile, "utf8")
  return Object.fromEntries(
    lines
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )
})()

const hasRoutingIntegrationEnv = env["GEO_FOUNDRY_ROUTING_INTEGRATION"] === "true"
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
  routeIndex: routeIndexOf({
    canonicalDomain: "site-a.test",
    routes: [
      { objectKey: "pages/a.json", pageType: "article", pathname: "/a", status: "active" },
      {
        objectKey: "pages/not-found.json",
        pageType: "not-found",
        pathname: "/not-found",
        status: "not-found",
      },
    ],
    schemaVersion: 1,
    siteId: SITE,
  }),
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

  it("verifies a prior immutable release and rolls v2 back to byte-identical v1", async () => {
    const v1 = planRelease(inputOf("-rollback-v1"))
    const v2 = planRelease(inputOf("-rollback-v2"))
    const verifiedV1 = await verifyManifest(v1.manifest)
    const verifiedV2 = await verifyManifest(v2.manifest)
    await publishRelease({ actor, planned: v1, store, verifiedManifest: verifiedV1 })
    await publishRelease({ actor, planned: v2, store, verifiedManifest: verifiedV2 })
    const v1PageKey = `sites/${SITE}/releases/${RELEASE("-rollback-v1")}/pages/a.json` as never
    const v1Before = await store.read({ key: v1PageKey })

    const result = await rollbackRelease({
      actor,
      expectedCurrentManifestSha256: verifiedV2.manifestSha256,
      expectedCurrentReleaseId: RELEASE("-rollback-v2"),
      expectedManifestSha256: verifiedV1.manifestSha256,
      recordedAt: "2026-08-20T12:00:00.000Z",
      releaseId: RELEASE("-rollback-v1"),
      siteId: SITE,
      store,
    })

    expect(result.receipt).toMatchObject({
      action: "rollback",
      fromReleaseId: RELEASE("-rollback-v2"),
      releaseId: RELEASE("-rollback-v1"),
    })
    expect(result.pointer).toMatchObject({
      manifestSha256: verifiedV1.manifestSha256,
      releaseId: RELEASE("-rollback-v1"),
    })
    expect(await store.read({ key: v1PageKey })).toEqual(v1Before)
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

describe.skipIf(!hasRustfsEnv || !hasRoutingIntegrationEnv)(
  "routing manifest publish against shared RustFS",
  () => {
    let routing: S3RoutingStore

    beforeAll(() => {
      routing = createS3RoutingStore({
        bucket: BUCKET,
        client,
        clientConfig: {},
        keyPrefix: "objects",
      })
    })

    it("rejects routing publish when a referenced site pointer is missing", async () => {
      await expect(
        publishRoutingManifest({
          manifest: {
            hosts: [{ canonical: true, host: "missing-site.test", siteId: "missing-site" }],
            schemaVersion: 1,
          },
          routingId: `t29routing${RUN}missing`,
          routingStore: routing,
          sitePointerObjectKeys: ["sites/missing-site/channels/current.json"],
          siteReleaseObjectKeys: [],
          updatedAt: "2026-08-20T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: ROUTING_PUBLISH_ERROR_CODE.ROUTING_SITE_POINTER_MISSING })
    })

    it("publishes the manifest, creates the pointer, and replays idempotently", async () => {
      const site = `t29rsite${RUN}`
      const releaseSuffix = "-routing"
      const plan = planRelease({
        compileOutput: compileOutput(),
        createdAt: "2026-08-20T00:00:00.000Z",
        releaseId: RELEASE(releaseSuffix),
        routingManifest: {
          hosts: [{ canonical: true, host: `${site}.test`, siteId: site }],
          schemaVersion: 1,
        },
        siteId: site,
        sourceVersionIds: ["edition-1-version-1"],
      })
      const verified = await verifyManifest(plan.manifest)
      const siteStore = createS3ArtifactStore({
        bucket: BUCKET,
        client,
        clientConfig: {},
        keyPrefix: "objects",
      })
      await publishRelease({ actor, planned: plan, store: siteStore, verifiedManifest: verified })

      const manifest = {
        hosts: [{ canonical: true, host: `${site}.test`, siteId: site }],
        schemaVersion: 1 as const,
      }
      const sha = await hashRoutingManifest(manifest)
      const pointer = await publishRoutingManifest({
        manifest,
        routingId: `t29routing${RUN}`,
        routingStore: routing,
        sitePointerObjectKeys: [`sites/${site}/channels/current.json`],
        siteReleaseObjectKeys: [`sites/${site}/releases/${RELEASE(releaseSuffix)}/manifest.json`],
        updatedAt: "2026-08-20T00:00:00.000Z",
      })
      expect(pointer).toMatchObject({ manifestSha256: sha, routingId: `t29routing${RUN}` })

      const replay = await publishRoutingManifest({
        manifest,
        routingId: `t29routing${RUN}`,
        routingStore: routing,
        sitePointerObjectKeys: [`sites/${site}/channels/current.json`],
        siteReleaseObjectKeys: [`sites/${site}/releases/${RELEASE(releaseSuffix)}/manifest.json`],
        updatedAt: "2026-08-20T00:00:00.000Z",
      })
      expect(replay).toEqual(pointer)
      const stored = await routing.readPointer()
      expect(JSON.parse(new TextDecoder().decode(stored))).toEqual(pointer)
    })
  },
)

import { ReleaseManifestSchema } from "./manifest.js"
import { createCurrentPointer, verifyManifest } from "./pointer.js"
import { AuditActorSchema, CanonicalTimestampSchema } from "./primitives.js"
import { PublishReceiptSchema, RollbackReceiptSchema } from "./receipts.js"

const actor = AuditActorSchema.parse({ actorId: "user-mark", kind: "user" })

const manifest = ReleaseManifestSchema.parse({
  compilerVersion: "1.0.0",
  createdAt: "2026-08-17T10:00:00.000Z",
  objects: [
    {
      bytes: 64,
      contentType: "image/svg+xml",
      path: "assets/logo.svg",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      bytes: 128,
      contentType: "application/json",
      path: "pages/en-US/index.json",
      sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  ],
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
  sourceVersionIds: ["source-001", "source-002"],
})

const verifiedRelease = await verifyManifest(manifest)
const manifestSha256 = verifiedRelease.manifestSha256

const pointer = createCurrentPointer({
  actor,
  release: verifiedRelease,
  updatedAt: CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
})

const publishReceipt = PublishReceiptSchema.parse({
  action: "publish",
  actor,
  manifestSha256,
  newEtag: '"etag-release-001"',
  oldEtag: null,
  recordedAt: "2026-08-17T10:05:00.000Z",
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
})

const rollbackReceipt = RollbackReceiptSchema.parse({
  action: "rollback",
  actor,
  fromManifestSha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  fromReleaseId: "release-002",
  manifestSha256,
  newEtag: '"etag-rollback-001"',
  oldEtag: '"etag-release-002"',
  recordedAt: "2026-08-17T11:00:00.000Z",
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
})

export const releaseContractFixtures = Object.freeze({
  manifest,
  pointer,
  publishReceipt,
  rollbackReceipt,
})

#!/usr/bin/env node
/**
 * Operator-only cleanup for run-scoped admin UI fixtures.
 *
 * This script intentionally has no create mode yet. Fixture creation is added
 * only once each legal human/service handoff has a browser-tested path. Cleanup
 * is exact-ID/key only and refuses records that do not still carry the run marker.
 */
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getPayload } from "payload"

import {
  assertRunId,
  markCleanup,
  readManifest,
  writeManifest,
} from "../../../.test/admin-fixture-manifest.mjs"

const root = new URL("../../..", import.meta.url).pathname
const args = process.argv.slice(2)
const command = args[0]
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const cleanupOrder = [
  "rollback-intents",
  "releases",
  "operations",
  "idempotency-records",
  "outbox-events",
  "quality-assessments",
  "url-records",
  "content-editions",
  "contents",
  "media",
  "domains",
  "sites",
  "users",
  "tenants",
]

const assertOperatorApproval = (runId) => {
  if (command !== "inspect" && command !== "cleanup") throw new Error("ADMIN_UI_FIXTURE_COMMAND_INVALID")
  if (args.includes("--allow-mk-dev") !== true) throw new Error("ADMIN_UI_FIXTURE_ALLOW_FLAG_REQUIRED")
  if (process.env.GEO_FOUNDRY_ADMIN_UI_FIXTURE_TARGET !== "mk-dev") {
    throw new Error("ADMIN_UI_FIXTURE_TARGET_REQUIRED")
  }
  if (process.env.GEO_FOUNDRY_ADMIN_UI_FIXTURES_ENABLED !== "confirm-mk-dev-only") {
    throw new Error("ADMIN_UI_FIXTURE_EXPLICIT_ENABLE_REQUIRED")
  }
  if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "runtime") {
    throw new Error("ADMIN_UI_FIXTURE_RUNTIME_MODE_REQUIRED")
  }
  return assertRunId(runId)
}

const rowContainsMarker = (value, marker, seen = new Set()) => {
  if (typeof value === "string") return value.includes(marker)
  if (value === null || typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((child) => rowContainsMarker(child, marker, seen))
}

const loadPayload = async () => {
  const { default: config } = await import("../src/payload.config.ts")
  return getPayload({ config })
}

const s3ClientOf = (environment) =>
  new S3Client({
    credentials: {
      accessKeyId: environment.rustfs.accessKeyId,
      secretAccessKey: environment.rustfs.secretAccessKey,
    },
    endpoint: environment.rustfs.endpoint,
    forcePathStyle: environment.rustfs.forcePathStyle,
    region: environment.rustfs.region,
  })

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

const runId = option("--run-id")
const manifestPath = option("--manifest")
if (runId === undefined || manifestPath === undefined) throw new Error("ADMIN_UI_FIXTURE_ARGUMENTS_REQUIRED")
assertOperatorApproval(runId)
const manifest = await readManifest({ path: manifestPath, root })
if (manifest.runId !== runId) throw new Error("ADMIN_UI_FIXTURE_MANIFEST_RUN_MISMATCH")

if (command === "inspect") {
  print({
    collections: manifest.records.reduce((counts, item) => {
      counts[item.collection] = (counts[item.collection] ?? 0) + 1
      return counts
    }, {}),
    objectCount: manifest.objects.length,
    recordCount: manifest.records.length,
    runId,
    status: manifest.status,
  })
  process.exitCode = 0
} else {
  const payload = await loadPayload()
  const { parseCmsEnvironment } = await import("../src/config/environment.ts")
  const environment = parseCmsEnvironment(process.env)
  const s3 = s3ClientOf(environment)
  const report = { deletedObjects: [], deletedRecords: [], failures: [], runId }
  try {
    if (manifest.status !== "active" && manifest.status !== "cleanup-failed") {
      throw new Error("ADMIN_UI_FIXTURE_MANIFEST_NOT_CLEANABLE")
    }
    for (const collection of cleanupOrder) {
      const records = manifest.records.filter((entry) => entry.collection === collection)
      for (const entry of records) {
        const document = await payload.findByID({
          collection,
          depth: 0,
          id: entry.id,
          overrideAccess: true,
        }).catch((error) => {
          if (String(error).includes("not found")) return null
          throw error
        })
        if (document === null) {
          report.deletedRecords.push({ collection, id: entry.id, outcome: "already-absent" })
          continue
        }
        if (!rowContainsMarker(document, entry.marker)) {
          throw new Error(`ADMIN_UI_FIXTURE_MARKER_MISMATCH:${collection}:${entry.id}`)
        }
        await payload.delete({ collection, id: entry.id, overrideAccess: true })
        report.deletedRecords.push({ collection, id: entry.id, outcome: "deleted" })
      }
    }
    for (const object of manifest.objects) {
      await s3.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }))
      report.deletedObjects.push({ bucket: object.bucket, key: object.key, outcome: "deleted" })
    }
    await writeManifest({ manifest: markCleanup(manifest, "cleaned"), path: manifestPath, root })
    print({ ...report, status: "cleaned" })
  } catch (error) {
    report.failures.push({ code: error instanceof Error ? error.message : "ADMIN_UI_FIXTURE_CLEANUP_FAILED" })
    await writeManifest({ manifest: markCleanup(manifest, "cleanup-failed"), path: manifestPath, root })
    print({ ...report, status: "cleanup-failed" })
    process.exitCode = 1
  } finally {
    await payload.destroy()
  }
}

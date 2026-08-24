import assert from "node:assert/strict"
import test from "node:test"

import {
  assertRunId,
  createFixtureManifest,
  markCleanup,
  trackObject,
  trackRecord,
  validateManifest,
} from "./admin-fixture-manifest.mjs"

test("manifest tracks only exact run-marked resources", () => {
  const runId = "admin-ui-20260823-a1b2c3d4"
  const created = createFixtureManifest({ baseUrl: "https://geo-foundry-mk-dev.aixllent.com", runId })
  const withRecord = trackRecord(created, {
    collection: "sites",
    createdAt: "2026-08-23T00:00:00.000Z",
    id: 42,
    marker: `Site ${runId}`,
    tenantId: 9,
  })
  const manifest = trackObject(withRecord, {
    bucket: "geo-foundry",
    createdAt: "2026-08-23T00:00:00.000Z",
    key: `objects/media/${runId}/pixel.png`,
  })
  assert.equal(manifest.records.length, 1)
  assert.equal(manifest.objects.length, 1)
  assert.equal(markCleanup(manifest, "cleaned").status, "cleaned")
})

test("manifest rejects invalid run IDs and broad or unmarked resources", () => {
  assert.throws(() => assertRunId("admin-ui-test"), /ADMIN_UI_RUN_ID_INVALID/)
  const manifest = createFixtureManifest({
    baseUrl: "https://geo-foundry-mk-dev.aixllent.com",
    runId: "admin-ui-20260823-a1b2c3d4",
  })
  assert.throws(
    () =>
      trackRecord(manifest, {
        collection: "sites",
        createdAt: "2026-08-23T00:00:00.000Z",
        id: 7,
        marker: "unrelated record",
      }),
    /ADMIN_UI_MANIFEST_MARKER_MISMATCH/,
  )
  assert.throws(
    () =>
      validateManifest({ ...manifest, status: "unknown" }),
    /ADMIN_UI_MANIFEST_STATUS_INVALID/,
  )
})

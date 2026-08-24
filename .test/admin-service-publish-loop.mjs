#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { ContentServiceClient } from "../packages/content-client/dist/index.js"
import {
  compileAndPlanRelease,
  createWorkerArtifactStore,
  parseWorkerS3Options,
  publishPlannedRelease,
} from "../apps/worker/dist/processors/release-pipeline.js"
import { readManifest } from "./admin-fixture-manifest.mjs"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const servicePasswordFile = process.env.ADMIN_UI_CONTENT_SERVICE_PASSWORD_FILE
const publisherPasswordFile = process.env.ADMIN_UI_PUBLISHER_PASSWORD_FILE
const s3AccessKeyFile = process.env.ADMIN_UI_S3_ACCESS_KEY_FILE
const s3SecretKeyFile = process.env.ADMIN_UI_S3_SECRET_KEY_FILE

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_PUBLISH_WORKER_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_PUBLISH_WORKER_LOOP_RUN_ID_REQUIRED")
}

const secureTextFile = async (path, code) => {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${code}_REQUIRED`)
  const metadata = await stat(path)
  if (metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${code}_INSECURE`)
  }
  const value = (await readFile(path, "utf8")).trim()
  if (value.length === 0) throw new Error(`${code}_EMPTY`)
  return value
}

const servicePassword = await secureTextFile(
  servicePasswordFile,
  "ADMIN_PUBLISH_WORKER_SERVICE_PASSWORD_FILE",
)

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifestPath = resolve(evidenceDirectory, "fixture-manifest.json")
const manifest = await readManifest({ root, path: manifestPath })
const edition = manifest.records.find((record) => record.collection === "content-editions")
const tenant = manifest.records.find((record) => record.collection === "tenants")
if (edition === undefined || tenant === undefined) {
  throw new Error("ADMIN_PUBLISH_WORKER_UPSTREAM_RECORDS_MISSING")
}

const submissionPath = resolve(evidenceDirectory, "publisher-publish-submission.json")
const submission = JSON.parse(await readFile(submissionPath, "utf8"))
if (submission.editionId !== edition.id) {
  throw new Error("ADMIN_PUBLISH_WORKER_SUBMISSION_EDITION_MISMATCH")
}

const serviceEmail = `ui-loop-service-${runId}@geo-foundry.test`
const urlOf = (route) => new URL(route, baseUrl).toString()

const loginResponse = await fetch(urlOf("/api/users/login"), {
  body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
  headers: { "content-type": "application/json" },
  method: "POST",
})
const loginBody = await loginResponse.json().catch(() => null)
const token = loginBody?.token
if (loginResponse.status !== 200 || typeof token !== "string" || token.length === 0) {
  throw new Error(`ADMIN_PUBLISH_WORKER_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}

const client = new ContentServiceClient({ apiKey: token, baseUrl: baseUrl.origin })
const context = { client, logger: () => undefined }

const before = await client.getEditionInput(edition.id)
if (before.tenantId !== tenant.id) {
  throw new Error("ADMIN_PUBLISH_WORKER_TENANT_MISMATCH")
}
if (before.workflowStatus !== "compiled" && before.workflowStatus !== "published") {
  throw new Error(`ADMIN_PUBLISH_WORKER_STATUS_INVALID:${before.workflowStatus}`)
}
if (before.compiledRelease !== submission.releaseId) {
  throw new Error("ADMIN_PUBLISH_WORKER_RELEASE_MISMATCH")
}

// A prior invocation of this exact idempotency key may have already
// completed the real compile+upload+registry write before this script's own
// bookkeeping crashed; compileAndPlanRelease only accepts approved/compiled
// editions, so an already-published edition under the same release is
// treated as a successful prior completion rather than redone.
const bucket = process.env.ADMIN_UI_S3_BUCKET ?? "geo-foundry"
const keyPrefix = "objects"
const pointerKey = `${keyPrefix}/releases/site-${before.siteId}/current.json`

let manifestSha256
let objectCount
let releaseObjectKeys

if (before.workflowStatus === "published") {
  const publisherPassword = await secureTextFile(
    publisherPasswordFile,
    "ADMIN_PUBLISH_WORKER_PUBLISHER_PASSWORD_FILE",
  )
  const publisherLogin = await fetch(urlOf("/api/users/login"), {
    body: JSON.stringify({
      email: `ui-loop-publisher-${runId}@geo-foundry.test`,
      password: publisherPassword,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const publisherLoginBody = await publisherLogin.json().catch(() => null)
  const publisherToken = publisherLoginBody?.token
  if (
    publisherLogin.status !== 200 ||
    typeof publisherToken !== "string" ||
    publisherToken.length === 0
  ) {
    throw new Error(`ADMIN_PUBLISH_WORKER_PUBLISHER_LOGIN_FAILED:${publisherLogin.status}`)
  }
  const releaseLookup = await fetch(
    urlOf(
      `/api/releases?depth=0&limit=1&where[releaseId][equals]=${encodeURIComponent(submission.releaseId)}`,
    ),
    { headers: { authorization: `Bearer ${publisherToken}` } },
  )
  const releaseBody = await releaseLookup.json().catch(() => null)
  const releaseDoc = releaseBody?.docs?.[0]
  if (releaseLookup.status !== 200 || releaseDoc === undefined) {
    throw new Error(
      `ADMIN_PUBLISH_WORKER_RELEASE_LOOKUP_FAILED:${JSON.stringify({ status: releaseLookup.status })}`,
    )
  }
  manifestSha256 = releaseDoc.manifestSha256
  objectCount = Array.isArray(releaseDoc.receipt?.manifest?.objects)
    ? releaseDoc.receipt.manifest.objects.length
    : null
  releaseObjectKeys = null
} else {
  const planned = await compileAndPlanRelease(context, {
    editionId: edition.id,
    operationId: submission.operationId,
  })
  if (planned.releaseId !== submission.releaseId) {
    throw new Error("ADMIN_PUBLISH_WORKER_PLANNED_RELEASE_MISMATCH")
  }

  const store = createWorkerArtifactStore(
    parseWorkerS3Options(
      {
        GEO_FOUNDRY_S3_ACCESS_KEY_FILE: s3AccessKeyFile,
        GEO_FOUNDRY_S3_BUCKET: bucket,
        GEO_FOUNDRY_S3_ENDPOINT: process.env.ADMIN_UI_S3_ENDPOINT ?? "127.0.0.1",
        GEO_FOUNDRY_S3_PORT: process.env.ADMIN_UI_S3_PORT ?? "9000",
        GEO_FOUNDRY_S3_SECRET_KEY_FILE: s3SecretKeyFile,
        GEO_FOUNDRY_S3_USE_SSL: "false",
      },
      (path) => readFileSync(path, "utf8").trim(),
    ),
  )

  const receipt = await publishPlannedRelease(context, {
    editionId: edition.id,
    operationId: submission.operationId,
    planned,
    store,
  })
  if (receipt.releaseId !== submission.releaseId) {
    throw new Error("ADMIN_PUBLISH_WORKER_RECEIPT_RELEASE_MISMATCH")
  }
  manifestSha256 = planned.manifestSha256
  objectCount = planned.objectCount
  // Release object keys are content-addressed by site/releaseId, not by this
  // run's marker, so they cannot satisfy the strict manifest's runId-embedded
  // key contract (admin-fixture-manifest.mjs). They are recorded here instead,
  // scoped exactly by the already-tracked run site id, for the cleanup phase.
  releaseObjectKeys = planned.plan.manifest.objects.map((object) => `${keyPrefix}/${object.path}`)
}

const after = await client.getEditionInput(edition.id)
if (after.workflowStatus !== "published" || after.compiledRelease !== submission.releaseId) {
  throw new Error(
    `ADMIN_PUBLISH_WORKER_STATE_MISMATCH:${JSON.stringify({
      compiledRelease: after.compiledRelease,
      workflowStatus: after.workflowStatus,
    })}`,
  )
}

const result = {
  bucket,
  editionId: edition.id,
  manifestSha256,
  objectCount,
  operationId: submission.operationId,
  pointerKey,
  releaseId: submission.releaseId,
  releaseObjectKeys,
  siteId: before.siteId,
  workflowStatus: after.workflowStatus,
}
await writeFile(
  resolve(evidenceDirectory, "content-service-publish-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
)
console.log(JSON.stringify(result))

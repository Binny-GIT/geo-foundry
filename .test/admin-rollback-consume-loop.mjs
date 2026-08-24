#!/usr/bin/env node
// Consumes the real approved rollback intent exactly as the worker's
// rollback-gate processor does: a content-service-submitted ledger
// operation, a one-time intent consumption, a real CAS pointer switch back
// to the prior verified release, and a real rollback receipt recorded
// through the protected registry endpoint.
import { readFileSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { ContentServiceClient } from "../packages/content-client/dist/index.js"
import {
  createWorkerArtifactStore,
  parseWorkerS3Options,
} from "../apps/worker/dist/processors/release-pipeline.js"
import { rollbackRelease } from "../packages/publisher/dist/index.js"
import {
  AuditActorSchema,
  CanonicalTimestampSchema,
} from "../packages/schema/dist/release/v1/index.js"

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
  throw new Error("ADMIN_ROLLBACK_CONSUME_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_ROLLBACK_CONSUME_LOOP_RUN_ID_REQUIRED")
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
  "ADMIN_ROLLBACK_CONSUME_SERVICE_PASSWORD_FILE",
)

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const intentResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "rollback-intent-create-result.json"), "utf8"),
)
const publishResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "content-service-publish-result.json"), "utf8"),
)
const siteId = publishResult.siteId
const runtimeSiteId = `site-${siteId}`

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
  throw new Error(`ADMIN_ROLLBACK_CONSUME_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}
const client = new ContentServiceClient({ apiKey: token, baseUrl: baseUrl.origin })

// Look up the exact manifest hashes for source/target releases through the
// same protected surface a human publisher already verified (content-service
// has no Releases read access - this is a read-only publisher session call).
const publisherPassword = await secureTextFile(
  publisherPasswordFile,
  "ADMIN_ROLLBACK_CONSUME_PUBLISHER_PASSWORD_FILE",
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
  throw new Error(`ADMIN_ROLLBACK_CONSUME_PUBLISHER_LOGIN_FAILED:${publisherLogin.status}`)
}
const releasesResponse = await fetch(
  urlOf(
    `/api/releases?depth=0&limit=10&where[site][equals]=${siteId}`,
  ),
  { headers: { authorization: `Bearer ${publisherToken}` } },
)
const releasesBody = await releasesResponse.json().catch(() => null)
const docs = Array.isArray(releasesBody?.docs) ? releasesBody.docs : []
const sourceDoc = docs.find((doc) => doc.releaseId === intentResult.sourceReleaseId)
const targetDoc = docs.find((doc) => doc.releaseId === intentResult.targetReleaseId)
if (releasesResponse.status !== 200 || sourceDoc === undefined || targetDoc === undefined) {
  throw new Error(`ADMIN_ROLLBACK_CONSUME_RELEASE_LOOKUP_FAILED:${releasesResponse.status}`)
}
if (sourceDoc.state !== "current") {
  throw new Error(`ADMIN_ROLLBACK_CONSUME_SOURCE_NOT_CURRENT:${sourceDoc.state}`)
}

// --- ledger operation: rollback, submitted by content-service ---
const idempotencyKey = `rollback-${runId}`
const requestBody = {
  expectedCurrentManifestSha256: sourceDoc.manifestSha256,
  expectedCurrentReleaseId: intentResult.sourceReleaseId,
  expectedManifestSha256: targetDoc.manifestSha256,
  reason: `Consume verified rollback intent for ${runId}`,
  rollbackIntentId: intentResult.intentId,
  siteId: runtimeSiteId,
  targetReleaseId: intentResult.targetReleaseId,
}
const submitted = await client.submitOperation({
  endpoint: "/v1/rollback",
  idempotencyKey,
  operationType: "rollback",
  requestPayload: { body: requestBody },
  siteId,
})
const operationId = submitted.operation.operationId

await client.startOperationStage(operationId, { attempt: submitted.operation.attempt, stage: "rollback-gate" })

// --- consume the intent exactly once ---
await client.consumeRollbackIntent({
  expectedCurrentManifestSha256: requestBody.expectedCurrentManifestSha256,
  expectedCurrentReleaseId: requestBody.expectedCurrentReleaseId,
  expectedManifestSha256: requestBody.expectedManifestSha256,
  operationId,
  rollbackIntentId: requestBody.rollbackIntentId,
  runtimeSiteId: requestBody.siteId,
  targetReleaseId: requestBody.targetReleaseId,
})

// --- real CAS pointer switch back to the verified prior release ---
const store = createWorkerArtifactStore(
  parseWorkerS3Options(
    {
      GEO_FOUNDRY_S3_ACCESS_KEY_FILE: s3AccessKeyFile,
      GEO_FOUNDRY_S3_BUCKET: process.env.ADMIN_UI_S3_BUCKET ?? "geo-foundry",
      GEO_FOUNDRY_S3_ENDPOINT: process.env.ADMIN_UI_S3_ENDPOINT ?? "127.0.0.1",
      GEO_FOUNDRY_S3_PORT: process.env.ADMIN_UI_S3_PORT ?? "9000",
      GEO_FOUNDRY_S3_SECRET_KEY_FILE: s3SecretKeyFile,
      GEO_FOUNDRY_S3_USE_SSL: "false",
    },
    (path) => readFileSync(path, "utf8").trim(),
  ),
)
const rollbackResult = await rollbackRelease({
  actor: AuditActorSchema.parse({ actorId: "worker-publisher", kind: "service" }),
  expectedCurrentManifestSha256: requestBody.expectedCurrentManifestSha256,
  expectedCurrentReleaseId: requestBody.expectedCurrentReleaseId,
  expectedManifestSha256: requestBody.expectedManifestSha256,
  recordedAt: CanonicalTimestampSchema.parse(new Date().toISOString()),
  releaseId: requestBody.targetReleaseId,
  siteId: requestBody.siteId,
  store,
})

await client.recordRollbackReceipt({ operationId, receipt: rollbackResult.receipt })

const final = await client.completeOperationStage(operationId, {
  attempt: submitted.operation.attempt,
  outcome: "succeeded",
  result: { receipt: rollbackResult.receipt },
  stage: "rollback-gate",
})

const result = {
  intentId: intentResult.intentId,
  operationId,
  operationState: final.state,
  sourceReleaseId: intentResult.sourceReleaseId,
  targetReleaseId: intentResult.targetReleaseId,
}
await writeFile(
  resolve(evidenceDirectory, "rollback-consume-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
)
console.log(JSON.stringify(result))

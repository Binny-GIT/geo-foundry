#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { ContentServiceClient } from "../packages/content-client/dist/index.js"
import { compileAndPlanRelease } from "../apps/worker/dist/processors/release-pipeline.js"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const servicePasswordFile = process.env.ADMIN_UI_CONTENT_SERVICE_PASSWORD_FILE

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_SECOND_COMPILE_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_SECOND_COMPILE_LOOP_RUN_ID_REQUIRED")
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
  "ADMIN_SECOND_COMPILE_SERVICE_PASSWORD_FILE",
)

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const approveResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "second-edition-approve-result.json"), "utf8"),
)
const editionId = approveResult.editionId
const operationId = `compile-2-${runId}`

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
  throw new Error(`ADMIN_SECOND_COMPILE_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}

const client = new ContentServiceClient({ apiKey: token, baseUrl: baseUrl.origin })
const context = { client, logger: () => undefined }
const before = await client.getEditionInput(editionId)
if (before.workflowStatus !== "approved" && before.workflowStatus !== "compiled") {
  throw new Error(`ADMIN_SECOND_COMPILE_STATUS_INVALID:${before.workflowStatus}`)
}

const planned = await compileAndPlanRelease(context, { editionId, operationId })
const totalBytes = planned.plan.manifest.objects.reduce((sum, object) => sum + object.bytes, 0)
const receipt = await client.recordCompileResult(
  editionId,
  {
    manifestSha256: planned.manifestSha256,
    objectCount: planned.objectCount,
    releaseId: planned.releaseId,
    totalBytes,
  },
  { operationId, requestId: `compile-2-record-${runId}` },
)
if (receipt.workflowStatus !== "compiled" || receipt.releaseId !== planned.releaseId) {
  throw new Error("ADMIN_SECOND_COMPILE_RECEIPT_MISMATCH")
}

const after = await client.getEditionInput(editionId)
if (after.workflowStatus !== "compiled" || after.compiledRelease !== planned.releaseId) {
  throw new Error(
    `ADMIN_SECOND_COMPILE_STATE_MISMATCH:${JSON.stringify({
      compiledRelease: after.compiledRelease,
      workflowStatus: after.workflowStatus,
    })}`,
  )
}

const result = {
  editionId,
  manifestSha256: planned.manifestSha256,
  objectCount: planned.objectCount,
  operationId,
  releaseId: planned.releaseId,
  totalBytes,
  workflowStatus: after.workflowStatus,
}
await writeFile(
  resolve(evidenceDirectory, "second-edition-compile-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
)
console.log(JSON.stringify(result))

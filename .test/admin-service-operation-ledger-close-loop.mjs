#!/usr/bin/env node
// Closes the operation ledger stage lifecycle for a publish operation that
// was completed by directly invoking the release pipeline functions (this
// run's compile/publish verification) rather than through the worker's
// BullMQ operationProcessor wrapper. The real compile+upload+registry work
// already succeeded; this only records that true outcome through the same
// protected stage endpoints the worker itself would call, so the ledger
// stops showing a stale "queued" state for work that is already done.
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { ContentServiceClient } from "../packages/content-client/dist/index.js"

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
  throw new Error("ADMIN_OPERATION_CLOSE_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_OPERATION_CLOSE_LOOP_RUN_ID_REQUIRED")
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
  "ADMIN_OPERATION_CLOSE_SERVICE_PASSWORD_FILE",
)

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const publishResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "content-service-publish-result.json"), "utf8"),
)

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
  throw new Error(`ADMIN_OPERATION_CLOSE_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}

const client = new ContentServiceClient({ apiKey: token, baseUrl: baseUrl.origin })
const stage = "publish-gate"

const before = await client.getOperation(publishResult.operationId)
if (before.operationType !== "publish") {
  throw new Error(`ADMIN_OPERATION_CLOSE_TYPE_MISMATCH:${before.operationType}`)
}

let final = before
if (before.state === "queued") {
  await client.startOperationStage(publishResult.operationId, {
    attempt: before.attempt,
    stage,
  })
  final = await client.completeOperationStage(publishResult.operationId, {
    attempt: before.attempt,
    outcome: "succeeded",
    result: {
      manifestSha256: publishResult.manifestSha256,
      releaseId: publishResult.releaseId,
    },
    stage,
  })
} else if (before.state !== "succeeded") {
  throw new Error(`ADMIN_OPERATION_CLOSE_STATE_UNEXPECTED:${before.state}`)
}

if (final.state !== "succeeded") {
  throw new Error(`ADMIN_OPERATION_CLOSE_FINAL_STATE_INVALID:${final.state}`)
}

const result = {
  attempt: final.attempt,
  operationId: publishResult.operationId,
  operationType: final.operationType,
  result: final.result,
  state: final.state,
}
await writeFile(
  resolve(evidenceDirectory, "operation-ledger-close-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
)
console.log(JSON.stringify(result))

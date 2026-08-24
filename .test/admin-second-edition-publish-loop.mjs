#!/usr/bin/env node
// Publisher submits a real publish operation for the second edition through
// the actual UI button, then the worker step completes it for real (compile
// reuse of the compiled release id, real S3 upload, real registry write,
// real workflow advance to published) - producing the site's second current
// release so Rollback Intent creation has a genuine source/target pair.
import { readFileSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { chromium } from "@playwright/test"

import { ContentServiceClient } from "../packages/content-client/dist/index.js"
import {
  compileAndPlanRelease,
  createWorkerArtifactStore,
  parseWorkerS3Options,
  publishPlannedRelease,
} from "../apps/worker/dist/processors/release-pipeline.js"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const publisherPasswordFile = process.env.ADMIN_UI_PUBLISHER_PASSWORD_FILE
const servicePasswordFile = process.env.ADMIN_UI_CONTENT_SERVICE_PASSWORD_FILE
const s3AccessKeyFile = process.env.ADMIN_UI_S3_ACCESS_KEY_FILE
const s3SecretKeyFile = process.env.ADMIN_UI_S3_SECRET_KEY_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_SECOND_PUBLISH_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_SECOND_PUBLISH_LOOP_RUN_ID_REQUIRED")
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
const [publisherPassword, servicePassword] = await Promise.all([
  secureTextFile(publisherPasswordFile, "ADMIN_SECOND_PUBLISH_PUBLISHER_PASSWORD_FILE"),
  secureTextFile(servicePasswordFile, "ADMIN_SECOND_PUBLISH_SERVICE_PASSWORD_FILE"),
])

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const compileResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "second-edition-compile-result.json"), "utf8"),
)
const createResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "second-edition-create-result.json"), "utf8"),
)
const editionId = compileResult.editionId
const title = createResult.title

const urlOf = (route) => new URL(route, baseUrl).toString()

// --- publisher: real browser click ---
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
const page = await context.newPage()
const hardErrors = []
page.on("console", (message) => {
  if (message.type() === "error" && !/favicon/i.test(message.text())) {
    hardErrors.push(message.text())
  }
})
page.on("pageerror", (error) => hardErrors.push(String(error)))

let operation
try {
  await page.goto(urlOf("/admin/login"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  await page
    .locator('input[name="email"], input[type="email"]')
    .first()
    .fill(`ui-loop-publisher-${runId}@geo-foundry.test`)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(publisherPassword)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })

  await page.goto(urlOf(`/admin/collections/content-editions/${editionId}`), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const publishButton = page.getByRole("button", { name: "Publish edition", exact: true })
  await publishButton.waitFor({ state: "visible", timeout: timeoutMs })
  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${editionId}/publish-operations`),
    { timeout: timeoutMs },
  )
  await publishButton.click()
  const response = await publishResponse
  const body = await response.json().catch(() => null)
  if (response.status() !== 200 && response.status() !== 202) {
    throw new Error(
      `ADMIN_SECOND_PUBLISH_SUBMIT_FAILED:${JSON.stringify({ body, status: response.status() })}`,
    )
  }
  operation = body?.operation
  if (typeof operation?.operationId !== "string" || typeof operation?.releaseId !== "string") {
    throw new Error(`ADMIN_SECOND_PUBLISH_OPERATION_INVALID:${JSON.stringify(body)}`)
  }
  if (operation.releaseId !== compileResult.releaseId) {
    throw new Error("ADMIN_SECOND_PUBLISH_RELEASE_MISMATCH")
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "second-edition-publish-requested.png"),
    fullPage: true,
  })
} finally {
  await context.close()
  await browser.close()
}
if (hardErrors.length > 0) {
  throw new Error(`ADMIN_SECOND_PUBLISH_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
}

// --- worker step: real compile + real S3 upload + real registry write ---
const serviceEmail = `ui-loop-service-${runId}@geo-foundry.test`
const loginResponse = await fetch(urlOf("/api/users/login"), {
  body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
  headers: { "content-type": "application/json" },
  method: "POST",
})
const loginBody = await loginResponse.json().catch(() => null)
const token = loginBody?.token
if (loginResponse.status !== 200 || typeof token !== "string" || token.length === 0) {
  throw new Error(`ADMIN_SECOND_PUBLISH_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}
const client = new ContentServiceClient({ apiKey: token, baseUrl: baseUrl.origin })
const workerContext = { client, logger: () => undefined }

const planned = await compileAndPlanRelease(workerContext, {
  editionId,
  operationId: operation.operationId,
})
if (planned.releaseId !== compileResult.releaseId) {
  throw new Error("ADMIN_SECOND_PUBLISH_PLANNED_RELEASE_MISMATCH")
}
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
const receipt = await publishPlannedRelease(workerContext, {
  editionId,
  operationId: operation.operationId,
  planned,
  store,
})
if (receipt.releaseId !== compileResult.releaseId) {
  throw new Error("ADMIN_SECOND_PUBLISH_RECEIPT_RELEASE_MISMATCH")
}

const after = await client.getEditionInput(editionId)
if (after.workflowStatus !== "published" || after.compiledRelease !== compileResult.releaseId) {
  throw new Error(
    `ADMIN_SECOND_PUBLISH_STATE_MISMATCH:${JSON.stringify({
      compiledRelease: after.compiledRelease,
      workflowStatus: after.workflowStatus,
    })}`,
  )
}

const before = await client.getOperation(operation.operationId)
await client.startOperationStage(operation.operationId, {
  attempt: before.attempt,
  stage: "publish-gate",
})
const finalOperation = await client.completeOperationStage(operation.operationId, {
  attempt: before.attempt,
  outcome: "succeeded",
  result: { manifestSha256: planned.manifestSha256, releaseId: receipt.releaseId },
  stage: "publish-gate",
})

const result = {
  editionId,
  manifestSha256: planned.manifestSha256,
  operationId: operation.operationId,
  operationState: finalOperation.state,
  releaseId: receipt.releaseId,
  workflowStatus: after.workflowStatus,
}
await writeFile(
  resolve(evidenceDirectory, "second-edition-publish-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
)
console.log(JSON.stringify(result))

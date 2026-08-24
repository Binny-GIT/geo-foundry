#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const servicePasswordFile = process.env.ADMIN_UI_CONTENT_SERVICE_PASSWORD_FILE
const reviewerPasswordFile = process.env.ADMIN_UI_REVIEWER_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_SECOND_APPROVE_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_SECOND_APPROVE_LOOP_RUN_ID_REQUIRED")
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
const [servicePassword, reviewerPassword] = await Promise.all([
  secureTextFile(servicePasswordFile, "ADMIN_SECOND_APPROVE_SERVICE_PASSWORD_FILE"),
  secureTextFile(reviewerPasswordFile, "ADMIN_SECOND_APPROVE_REVIEWER_PASSWORD_FILE"),
])

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const createResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "second-edition-create-result.json"), "utf8"),
)
const editionId = createResult.editionId
const title = createResult.title

const serviceEmail = `ui-loop-service-${runId}@geo-foundry.test`
const reviewerEmail = `ui-loop-reviewer-${runId}@geo-foundry.test`
const urlOf = (route) => new URL(route, baseUrl).toString()

// --- content-service: record a passed assessment for the exact live content hash ---
const loginResponse = await fetch(urlOf("/api/users/login"), {
  body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
  headers: { "content-type": "application/json" },
  method: "POST",
})
const loginBody = await loginResponse.json().catch(() => null)
const token = loginBody?.token
if (loginResponse.status !== 200 || typeof token !== "string" || token.length === 0) {
  throw new Error(`ADMIN_SECOND_APPROVE_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
}
const inputResponse = await fetch(urlOf(`/api/internal/editions/${editionId}/input`), {
  headers: { authorization: `Bearer ${token}`, "x-request-id": `second-input-${runId}` },
})
const input = await inputResponse.json().catch(() => null)
if (
  inputResponse.status !== 200 ||
  typeof input?.inputHash !== "string" ||
  input.inputHash.length !== 64 ||
  input.workflowStatus !== "review"
) {
  throw new Error(
    `ADMIN_SECOND_APPROVE_INPUT_FAILED:${JSON.stringify({ status: inputResponse.status, workflowStatus: input?.workflowStatus })}`,
  )
}
const assessmentResponse = await fetch(urlOf(`/api/internal/editions/${editionId}/assessments`), {
  body: JSON.stringify({
    dimensions: { editorial: 100, technical: 100 },
    inputHash: input.inputHash,
    issues: [],
    modelId: `browser-quality-2-${runId}`,
    overall: 100,
    promptVersion: "2026-08-23",
    provider: "admin-ui-loop",
    state: "passed",
    thresholdsHash: "a".repeat(64),
  }),
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-operation-id": `quality-2-${runId}`,
    "x-request-id": `assessment-2-${runId}`,
  },
  method: "POST",
})
const assessment = await assessmentResponse.json().catch(() => null)
if (assessmentResponse.status !== 200 || !Number.isInteger(assessment?.assessmentId)) {
  throw new Error(
    `ADMIN_SECOND_APPROVE_ASSESSMENT_FAILED:${JSON.stringify({ body: assessment, status: assessmentResponse.status })}`,
  )
}
const assessmentId = Number(assessment.assessmentId)

// --- reviewer: real browser approval ---
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

try {
  await page.goto(urlOf("/admin/login"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  await page.locator('input[name="email"], input[type="email"]').first().fill(reviewerEmail)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(reviewerPassword)
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
  const approveButton = page.getByRole("button", { name: "Approve edition", exact: true })
  await approveButton.waitFor({ state: "visible", timeout: timeoutMs })
  const approveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
    { timeout: timeoutMs },
  )
  await approveButton.click()
  const approved = await approveResponse
  const approvedBody = await approved.json().catch(() => null)
  if (approved.status() !== 200 || approvedBody?.workflowStatus !== "approved") {
    throw new Error(
      `ADMIN_SECOND_APPROVE_FAILED:${JSON.stringify({ body: approvedBody, status: approved.status() })}`,
    )
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "second-edition-approved.png"),
    fullPage: true,
  })

  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_SECOND_APPROVE_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    assessmentId,
    editionId,
    hardErrorCount: hardErrors.length,
    inputHash: input.inputHash,
    workflowStatus: approvedBody.workflowStatus,
  }
  await writeFile(
    resolve(evidenceDirectory, "second-edition-approve-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

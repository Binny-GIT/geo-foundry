#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

import {
  readManifest,
  trackRecord,
  writeManifest,
} from "./admin-fixture-manifest.mjs"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const tenantAdminPasswordFile = process.env.ADMIN_UI_TENANT_ADMIN_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_ASSESSMENT_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_ASSESSMENT_LOOP_RUN_ID_REQUIRED")
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

const tenantAdminPassword = await secureTextFile(
  tenantAdminPasswordFile,
  "ADMIN_ASSESSMENT_TENANT_ADMIN_PASSWORD_FILE",
)
const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const credentialsDirectory = resolve(evidenceDirectory, "credentials")
const servicePasswordPath = resolve(credentialsDirectory, "content-service-password")
const manifestPath = resolve(evidenceDirectory, "fixture-manifest.json")
let manifest = await readManifest({ root, path: manifestPath })
const edition = manifest.records.find((record) => record.collection === "content-editions")
const tenant = manifest.records.find((record) => record.collection === "tenants")
if (edition === undefined || tenant === undefined) {
  throw new Error("ADMIN_ASSESSMENT_UPSTREAM_RECORDS_MISSING")
}

const serviceEmail = `ui-loop-service-${runId}@geo-foundry.test`
const tenantAdminEmail = `ui-loop-tenant-admin-${runId}@geo-foundry.test`
const urlOf = (route) => new URL(route, baseUrl).toString()

await mkdir(credentialsDirectory, { recursive: true, mode: 0o700 })
let servicePassword
try {
  servicePassword = await secureTextFile(
    servicePasswordPath,
    "ADMIN_ASSESSMENT_SERVICE_PASSWORD_FILE",
  )
} catch (error) {
  if (
    !(error instanceof Error) ||
    (!("code" in error) || error.code !== "ENOENT")
  ) {
    throw error
  }
  servicePassword = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  await writeFile(servicePasswordPath, `${servicePassword}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}

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

const login = async () => {
  await page.goto(urlOf("/admin/login"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator('input[name="email"], input[type="email"]').first().fill(tenantAdminEmail)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(tenantAdminPassword)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })
  await page
    .getByRole("link", { name: /^Users$/ })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
}

const selectRole = async (role) => {
  const input = page.locator("#field-role input[role=combobox]")
  await input.fill(role)
  const option = page.getByRole("option", { name: role, exact: true })
  await option.waitFor({ state: "visible", timeout: timeoutMs })
  await option.click()
}

try {
  await login()
  const existing = await page.evaluate(async (email) => {
    const query = new URLSearchParams({
      depth: "0",
      limit: "2",
      "where[email][equals]": email,
    })
    const response = await fetch(`/api/users?${query}`, { credentials: "same-origin" })
    const body = await response.json().catch(() => null)
    return { docs: Array.isArray(body?.docs) ? body.docs : [], status: response.status }
  }, serviceEmail)
  if (existing.status !== 200) {
    throw new Error(`ADMIN_ASSESSMENT_SERVICE_QUERY_FAILED:${existing.status}`)
  }

  let serviceUserId
  let createdThroughUi = false
  if (existing.docs.length > 0) {
    serviceUserId = Number(existing.docs[0].id)
  } else {
    await page.goto(urlOf("/admin/collections/users/create"), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    })
    await page.locator('input[name="email"]').fill(serviceEmail)
    await page.locator('input[name="password"]').fill(servicePassword)
    const confirm = page.locator('input[name="confirm-password"]')
    if ((await confirm.count()) > 0) await confirm.fill(servicePassword)
    await selectRole("content-service")

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/api/users"),
      { timeout: timeoutMs },
    )
    await page.locator("#action-save").click()
    const response = await createResponse
    const body = await response.json().catch(() => null)
    if (response.status() < 200 || response.status() >= 300) {
      throw new Error(`ADMIN_ASSESSMENT_SERVICE_CREATE_FAILED:${response.status()}`)
    }
    serviceUserId = Number(body?.doc?.id ?? body?.id)
    createdThroughUi = true
  }

  if (!Number.isInteger(serviceUserId) || serviceUserId <= 0) {
    throw new Error("ADMIN_ASSESSMENT_SERVICE_ID_INVALID")
  }
  if (
    !manifest.records.some(
      (record) => record.collection === "users" && record.id === serviceUserId,
    )
  ) {
    manifest = trackRecord(manifest, {
      collection: "users",
      createdAt: new Date().toISOString(),
      id: serviceUserId,
      marker: serviceEmail,
      parentId: tenant.id,
      tenantId: tenant.id,
    })
    await writeManifest({ root, manifest, path: manifestPath })
  }

  await page.screenshot({
    path: resolve(evidenceDirectory, "content-service-user.png"),
    fullPage: true,
  })
  await context.close()

  const loginResponse = await fetch(urlOf("/api/users/login"), {
    body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const loginBody = await loginResponse.json().catch(() => null)
  const token = loginBody?.token
  if (loginResponse.status !== 200 || typeof token !== "string" || token.length === 0) {
    throw new Error(`ADMIN_ASSESSMENT_SERVICE_LOGIN_FAILED:${loginResponse.status}`)
  }

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  }
  const inputRequestId = `assessment-input-${runId}`
  const inputResponse = await fetch(
    urlOf(`/api/internal/editions/${edition.id}/input`),
    {
      headers: { authorization: headers.authorization, "x-request-id": inputRequestId },
    },
  )
  const input = await inputResponse.json().catch(() => null)
  if (
    inputResponse.status !== 200 ||
    typeof input?.inputHash !== "string" ||
    input.inputHash.length !== 64 ||
    input.workflowStatus !== "review"
  ) {
    throw new Error(
      `ADMIN_ASSESSMENT_INPUT_FAILED:${JSON.stringify({ status: inputResponse.status, workflowStatus: input?.workflowStatus })}`,
    )
  }

  const existingAssessmentResponse = await fetch(
    urlOf(
      `/api/quality-assessments?depth=0&limit=10&where[edition][equals]=${edition.id}&where[inputHash][equals]=${input.inputHash}`,
    ),
    { headers: { authorization: headers.authorization } },
  )
  const existingAssessment = await existingAssessmentResponse.json().catch(() => null)
  const matching = Array.isArray(existingAssessment?.docs)
    ? existingAssessment.docs.find(
        (assessment) =>
          assessment?.state === "passed" && assessment?.inputHash === input.inputHash,
      )
    : undefined

  let assessmentId
  let recordedThroughInternalEndpoint = false
  if (matching !== undefined) {
    assessmentId = Number(matching.id)
  } else {
    const requestId = `assessment-record-${runId}`
    const operationId = `quality-${runId}`
    const assessmentResponse = await fetch(
      urlOf(`/api/internal/editions/${edition.id}/assessments`),
      {
        body: JSON.stringify({
          dimensions: { editorial: 100, technical: 100 },
          inputHash: input.inputHash,
          issues: [],
          modelId: `browser-quality-${runId}`,
          overall: 100,
          promptVersion: "2026-08-23",
          provider: "admin-ui-loop",
          state: "passed",
          thresholdsHash: "a".repeat(64),
        }),
        headers: {
          ...headers,
          "x-operation-id": operationId,
          "x-request-id": requestId,
        },
        method: "POST",
      },
    )
    const assessment = await assessmentResponse.json().catch(() => null)
    if (assessmentResponse.status !== 200) {
      throw new Error(
        `ADMIN_ASSESSMENT_RECORD_FAILED:${JSON.stringify({ body: assessment, status: assessmentResponse.status })}`,
      )
    }
    assessmentId = Number(assessment?.assessmentId)
    recordedThroughInternalEndpoint = true
  }

  if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
    throw new Error("ADMIN_ASSESSMENT_ID_INVALID")
  }
  manifest = await readManifest({ root, path: manifestPath })
  if (
    !manifest.records.some(
      (record) =>
        record.collection === "quality-assessments" && record.id === assessmentId,
    )
  ) {
    manifest = trackRecord(manifest, {
      collection: "quality-assessments",
      createdAt: new Date().toISOString(),
      id: assessmentId,
      marker: `browser-quality-${runId}`,
      parentId: edition.id,
      tenantId: tenant.id,
    })
    await writeManifest({ root, manifest, path: manifestPath })
  }

  const result = {
    assessmentId,
    createdThroughUi,
    hardErrorCount: hardErrors.length,
    inputHash: input.inputHash,
    recordedThroughInternalEndpoint,
    serviceUserId,
    workflowStatus: input.workflowStatus,
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_ASSESSMENT_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }
  await writeFile(
    resolve(evidenceDirectory, "content-service-assessment-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}

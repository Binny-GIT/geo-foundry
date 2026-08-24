#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

import { readManifest } from "./admin-fixture-manifest.mjs"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const editorPasswordFile = process.env.ADMIN_UI_EDITOR_PASSWORD_FILE
const reviewerPasswordFile = process.env.ADMIN_UI_REVIEWER_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_WORKFLOW_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_WORKFLOW_LOOP_RUN_ID_REQUIRED")
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

const [editorPassword, reviewerPassword] = await Promise.all([
  secureTextFile(editorPasswordFile, "ADMIN_WORKFLOW_EDITOR_PASSWORD_FILE"),
  secureTextFile(reviewerPasswordFile, "ADMIN_WORKFLOW_REVIEWER_PASSWORD_FILE"),
])

const manifestPath = resolve(
  root,
  ".test",
  "admin-ui-evidence",
  runId,
  "fixture-manifest.json",
)
const manifest = await readManifest({ root, path: manifestPath })
const edition = manifest.records.find((record) => record.collection === "content-editions")
if (edition === undefined) throw new Error("ADMIN_WORKFLOW_EDITION_MISSING")

const editionId = edition.id
const title = `UI Loop Edition ${runId}`
const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const urlOf = (route) => new URL(route, baseUrl).toString()

const browser = await chromium.launch()
const hardErrors = []
const expectedConflictErrors = []
const trackerOf = (page) => {
  page.on("console", (message) => {
    if (message.type() !== "error" || /favicon/i.test(message.text())) return
    if (/Failed to load resource: the server responded with a status of 409/.test(message.text())) {
      expectedConflictErrors.push(message.text())
      return
    }
    hardErrors.push(message.text())
  })
  page.on("pageerror", (error) => hardErrors.push(String(error)))
}

const login = async (account) => {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const page = await context.newPage()
  trackerOf(page)
  await page.goto(urlOf("/admin/login"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator('input[name="email"], input[type="email"]').first().fill(account.email)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(account.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })
  await page
    .getByRole("link", { name: /^Contents$/ })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
  return { context, page }
}

const workflowStatus = async (page) =>
  page.evaluate(async (id) => {
    const response = await fetch(`/api/content-editions/${id}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return { revision: body?.workflowRevision ?? null, status: body?.workflowStatus ?? null }
  }, editionId)

try {
  const reviewer = await login({
    email: `ui-loop-reviewer-${runId}@geo-foundry.test`,
    password: reviewerPassword,
  })
  const initialStatus = await workflowStatus(reviewer.page)
  if (initialStatus.status === "review") {
    await reviewer.page.goto(
      urlOf(`/admin/collections/content-editions/${editionId}`),
      { timeout: timeoutMs, waitUntil: "domcontentloaded" },
    )
    const revisionButton = reviewer.page.getByRole("button", {
      name: "Request revision",
      exact: true,
    })
    await revisionButton.waitFor({ state: "visible", timeout: timeoutMs })
    const revisionResponse = reviewer.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
      { timeout: timeoutMs },
    )
    await revisionButton.click()
    const revised = await revisionResponse
    if (revised.status() !== 200) {
      throw new Error(`ADMIN_WORKFLOW_REVISION_FAILED:${revised.status()}`)
    }
    await reviewer.page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
    const resetStatus = await workflowStatus(reviewer.page)
    if (resetStatus.status !== "draft") {
      throw new Error(`ADMIN_WORKFLOW_REVISION_MISMATCH:${JSON.stringify(resetStatus)}`)
    }
  } else if (initialStatus.status !== "draft") {
    throw new Error(
      `ADMIN_WORKFLOW_INITIAL_STATE_UNSUPPORTED:${JSON.stringify(initialStatus)}`,
    )
  }

  const unauthorized = await reviewer.page.evaluate(async (id) => {
    const response = await fetch(`/api/editions/${id}/workflow-transitions`, {
      body: JSON.stringify({ target: "generating" }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const body = await response.json().catch(() => null)
    return { code: body?.error?.code ?? null, status: response.status }
  }, editionId)
  if (
    unauthorized.status !== 409 ||
    unauthorized.code !== "CONTENT_EDITION_EDITOR_REQUIRED"
  ) {
    throw new Error(
      `ADMIN_WORKFLOW_REVIEWER_BYPASS_NOT_REJECTED:${JSON.stringify(unauthorized)}`,
    )
  }
  const afterUnauthorized = await workflowStatus(reviewer.page)
  if (afterUnauthorized.status !== "draft") {
    throw new Error("ADMIN_WORKFLOW_UNAUTHORIZED_MUTATED_STATE")
  }
  await reviewer.context.close()

  const editor = await login({
    email: `ui-loop-editor-${runId}@geo-foundry.test`,
    password: editorPassword,
  })
  await editor.page.goto(
    urlOf(`/admin/collections/content-editions/${editionId}`),
    { timeout: timeoutMs, waitUntil: "domcontentloaded" },
  )
  await editor.page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })

  const startButton = editor.page.getByRole("button", {
    name: "Start generation",
    exact: true,
  })
  await startButton.waitFor({ state: "visible", timeout: timeoutMs })
  const generatingResponse = editor.page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
    { timeout: timeoutMs },
  )
  await startButton.click()
  const generating = await generatingResponse
  if (generating.status() !== 200) {
    throw new Error(`ADMIN_WORKFLOW_GENERATING_FAILED:${generating.status()}`)
  }
  await editor.page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  const afterGenerating = await workflowStatus(editor.page)
  if (afterGenerating.status !== "generating") {
    throw new Error(`ADMIN_WORKFLOW_GENERATING_MISMATCH:${JSON.stringify(afterGenerating)}`)
  }

  const submitButton = editor.page.getByRole("button", {
    name: "Submit for review",
    exact: true,
  })
  await submitButton.waitFor({ state: "visible", timeout: timeoutMs })
  const reviewResponse = editor.page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
    { timeout: timeoutMs },
  )
  await submitButton.click()
  const review = await reviewResponse
  if (review.status() !== 200) {
    throw new Error(`ADMIN_WORKFLOW_REVIEW_FAILED:${review.status()}`)
  }
  await editor.page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  const afterReview = await workflowStatus(editor.page)
  if (afterReview.status !== "review") {
    throw new Error(`ADMIN_WORKFLOW_REVIEW_MISMATCH:${JSON.stringify(afterReview)}`)
  }
  await editor.page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-editor-review.png"),
    fullPage: true,
  })
  await editor.context.close()

  const reviewerReview = await login({
    email: `ui-loop-reviewer-${runId}@geo-foundry.test`,
    password: reviewerPassword,
  })
  await reviewerReview.page.goto(
    urlOf(`/admin/collections/content-editions/${editionId}`),
    { timeout: timeoutMs, waitUntil: "domcontentloaded" },
  )
  await reviewerReview.page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const approve = reviewerReview.page.getByRole("button", {
    name: "Approve edition",
    exact: true,
  })
  const revision = reviewerReview.page.getByRole("button", {
    name: "Request revision",
    exact: true,
  })
  await approve.waitFor({ state: "visible", timeout: timeoutMs })
  await revision.waitFor({ state: "visible", timeout: timeoutMs })

  const approveResponse = reviewerReview.page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
    { timeout: timeoutMs },
  )
  await approve.click()
  const deniedApproval = await approveResponse
  const deniedBody = await deniedApproval.json().catch(() => null)
  if (
    deniedApproval.status() !== 409 ||
    deniedBody?.error?.code !== "EDITION_WORKFLOW_ASSESSMENT_REQUIRED"
  ) {
    throw new Error(
      `ADMIN_WORKFLOW_QUALITY_GATE_NOT_CLOSED:${JSON.stringify({ body: deniedBody, status: deniedApproval.status() })}`,
    )
  }
  await reviewerReview.page
    .getByText("A passed quality assessment is required before this transition.", {
      exact: true,
    })
    .waitFor({ state: "visible", timeout: timeoutMs })
  const afterDeniedApproval = await workflowStatus(reviewerReview.page)
  if (afterDeniedApproval.status !== "review") {
    throw new Error("ADMIN_WORKFLOW_DENIED_APPROVAL_MUTATED_STATE")
  }
  await reviewerReview.page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-reviewer-gate.png"),
    fullPage: true,
  })
  await reviewerReview.context.close()

  const result = {
    afterDeniedApproval,
    afterGenerating,
    afterReview,
    expectedConflictErrorCount: expectedConflictErrors.length,
    hardErrorCount: hardErrors.length,
    reviewerBypass: unauthorized,
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_WORKFLOW_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }
  await writeFile(
    resolve(evidenceDirectory, "content-edition-workflow-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}

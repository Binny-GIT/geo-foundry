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
const reviewerPasswordFile = process.env.ADMIN_UI_REVIEWER_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_REVIEW_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_REVIEW_LOOP_RUN_ID_REQUIRED")
}
if (typeof reviewerPasswordFile !== "string" || reviewerPasswordFile.length === 0) {
  throw new Error("ADMIN_REVIEW_LOOP_PASSWORD_FILE_REQUIRED")
}
const passwordMetadata = await stat(reviewerPasswordFile)
if (
  passwordMetadata.uid !== process.getuid() ||
  (passwordMetadata.mode & 0o077) !== 0
) {
  throw new Error("ADMIN_REVIEW_LOOP_PASSWORD_FILE_INSECURE")
}
const password = (await readFile(reviewerPasswordFile, "utf8")).trim()
if (password.length === 0) throw new Error("ADMIN_REVIEW_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifest = await readManifest({
  root,
  path: resolve(evidenceDirectory, "fixture-manifest.json"),
})
const edition = manifest.records.find((record) => record.collection === "content-editions")
const assessment = manifest.records.find(
  (record) => record.collection === "quality-assessments",
)
if (edition === undefined || assessment === undefined) {
  throw new Error("ADMIN_REVIEW_LOOP_RECORDS_MISSING")
}

const title = `UI Loop Edition ${runId}`
const email = `ui-loop-reviewer-${runId}@geo-foundry.test`
const urlOf = (route) => new URL(route, baseUrl).toString()
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

const statusOf = () =>
  page.evaluate(async (editionId) => {
    const response = await fetch(`/api/content-editions/${editionId}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      revision: body?.workflowRevision ?? null,
      status: body?.workflowStatus ?? null,
    }
  }, edition.id)

try {
  await page.goto(urlOf("/admin/login"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator('input[name="email"], input[type="email"]').first().fill(email)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })
  await page
    .getByRole("link", { name: /^Contents$/ })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })

  await page.goto(urlOf("/admin/collections/quality-assessments"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  const assessmentProbe = await page.evaluate(async (assessmentId) => {
    const response = await fetch(`/api/quality-assessments/${assessmentId}?depth=0`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      edition: body?.edition ?? null,
      id: body?.id ?? null,
      inputHash: body?.inputHash ?? null,
      state: body?.state ?? null,
      status: response.status,
    }
  }, assessment.id)
  if (
    assessmentProbe.status !== 200 ||
    Number(assessmentProbe.id) !== assessment.id ||
    Number(assessmentProbe.edition) !== edition.id ||
    assessmentProbe.state !== "passed"
  ) {
    throw new Error(
      `ADMIN_REVIEW_LOOP_ASSESSMENT_API_MISMATCH:${JSON.stringify(assessmentProbe)}`,
    )
  }
  const assessmentRow = page.locator("table tbody tr").filter({
    has: page.getByText("passed", { exact: true }),
  })
  await assessmentRow.first().waitFor({ state: "visible", timeout: timeoutMs })
  const assessmentRowText = await assessmentRow.first().innerText()
  if (!assessmentRowText.includes(String(assessmentProbe.inputHash))) {
    throw new Error("ADMIN_REVIEW_LOOP_ASSESSMENT_UI_MISMATCH")
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "quality-assessment-reviewer.png"),
    fullPage: true,
  })

  await page.goto(
    urlOf(`/admin/collections/content-editions/${edition.id}`),
    { timeout: timeoutMs, waitUntil: "domcontentloaded" },
  )
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const before = await statusOf()
  if (before.status === "review") {
    const approve = page.getByRole("button", {
      name: "Approve edition",
      exact: true,
    })
    await approve.waitFor({ state: "visible", timeout: timeoutMs })
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/editions/${edition.id}/workflow-transitions`),
      { timeout: timeoutMs },
    )
    await approve.click()
    const response = await responsePromise
    if (response.status() !== 200) {
      const body = await response.json().catch(() => null)
      throw new Error(
        `ADMIN_REVIEW_LOOP_APPROVE_FAILED:${JSON.stringify({ body, status: response.status() })}`,
      )
    }
    await page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  } else if (before.status !== "approved") {
    throw new Error(`ADMIN_REVIEW_LOOP_STATE_UNSUPPORTED:${JSON.stringify(before)}`)
  }

  const approved = await statusOf()
  if (approved.status !== "approved") {
    throw new Error(`ADMIN_REVIEW_LOOP_APPROVED_MISMATCH:${JSON.stringify(approved)}`)
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-approved.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByText("Workflow pipeline", { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const dashboardText = await page.locator("body").innerText()
  const approvedVisible = /Approved\s+1/.test(dashboardText.replaceAll("\n", " "))
  if (!approvedVisible) throw new Error("ADMIN_REVIEW_LOOP_DASHBOARD_APPROVED_MISSING")
  await page.screenshot({
    path: resolve(evidenceDirectory, "dashboard-approved.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/sites"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByText(`UI Loop Site ${runId}`, { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const sitesText = await page.locator("body").innerText()
  if (!sitesText.includes("0 draft")) {
    throw new Error("ADMIN_REVIEW_LOOP_SITE_DRAFT_NOT_CLEARED")
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "sites-approved.png"),
    fullPage: true,
  })

  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_REVIEW_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }
  const result = {
    approved,
    approvedVisible,
    assessmentId: assessment.id,
    assessmentRowText,
    hardErrorCount: hardErrors.length,
  }
  await writeFile(
    resolve(evidenceDirectory, "review-approve-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

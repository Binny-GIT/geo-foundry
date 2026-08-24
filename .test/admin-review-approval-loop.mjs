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
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_REVIEW_LOOP_PASSWORD_FILE_INSECURE")
}
const reviewerPassword = (await readFile(reviewerPasswordFile, "utf8")).trim()
if (reviewerPassword.length === 0) throw new Error("ADMIN_REVIEW_LOOP_PASSWORD_FILE_EMPTY")

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

const statusOf = async () =>
  page.evaluate(async (id) => {
    const response = await fetch(`/api/content-editions/${id}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      compiledRelease: body?.compiledRelease ?? null,
      revision: body?.workflowRevision ?? null,
      status: body?.workflowStatus ?? null,
    }
  }, edition.id)

try {
  await page.goto(urlOf("/admin/login"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page
    .locator('input[name="email"], input[type="email"]')
    .first()
    .fill(`ui-loop-reviewer-${runId}@geo-foundry.test`)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(reviewerPassword)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })
  await page
    .getByRole("link", { name: /^Quality Assessments$/ })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })

  await page.goto(urlOf("/admin/collections/quality-assessments"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  const assessmentLink = page.locator(
    `a[href="/admin/collections/quality-assessments/${assessment.id}"]`,
  )
  await assessmentLink.waitFor({ state: "visible", timeout: timeoutMs })
  const assessmentRow = page.locator("table tbody tr").filter({ has: assessmentLink })
  await assessmentRow.getByText(title, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const assessmentRowText = await assessmentRow.innerText()
  if (
    !assessmentRowText.toLowerCase().includes("passed") ||
    !assessmentRowText.includes(title)
  ) {
    throw new Error(
      `ADMIN_REVIEW_LOOP_ASSESSMENT_LIST_MISMATCH:${JSON.stringify(assessmentRowText)}`,
    )
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "quality-assessment-list.png"),
    fullPage: true,
  })

  await page.goto(
    urlOf(`/admin/collections/quality-assessments/${assessment.id}`),
    { timeout: timeoutMs, waitUntil: "domcontentloaded" },
  )
  await page.getByText("passed", { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const assessmentDetail = await page.locator("body").innerText()
  const assessmentProbe = await page.evaluate(async (assessmentId) => {
    const response = await fetch(`/api/quality-assessments/${assessmentId}?depth=0`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      edition: body?.edition ?? null,
      id: body?.id ?? null,
      inputHash: body?.inputHash ?? null,
      modelId: body?.modelId ?? null,
      state: body?.state ?? null,
      status: response.status,
    }
  }, assessment.id)
  if (
    assessmentProbe.status !== 200 ||
    Number(assessmentProbe.id) !== Number(assessment.id) ||
    Number(assessmentProbe.edition) !== Number(edition.id) ||
    assessmentProbe.state !== "passed" ||
    assessmentProbe.modelId !== assessment.marker ||
    typeof assessmentProbe.inputHash !== "string" ||
    assessmentProbe.inputHash.length !== 64
  ) {
    throw new Error(
      `ADMIN_REVIEW_LOOP_ASSESSMENT_DETAIL_MISMATCH:${JSON.stringify({ assessmentDetail, assessmentProbe })}`,
    )
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "quality-assessment-detail.png"),
    fullPage: true,
  })

  const before = await statusOf()
  if (before.status !== "review" && before.status !== "approved") {
    throw new Error(`ADMIN_REVIEW_LOOP_STATE_UNSUPPORTED:${JSON.stringify(before)}`)
  }

  let approvedThroughUi = false
  if (before.status === "review") {
    await page.goto(
      urlOf(`/admin/collections/content-editions/${edition.id}`),
      { timeout: timeoutMs, waitUntil: "domcontentloaded" },
    )
    await page.getByRole("heading", { name: title }).waitFor({
      state: "visible",
      timeout: timeoutMs,
    })
    const approve = page.getByRole("button", {
      name: "Approve edition",
      exact: true,
    })
    await approve.waitFor({ state: "visible", timeout: timeoutMs })
    const approvalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/editions/${edition.id}/workflow-transitions`),
      { timeout: timeoutMs },
    )
    await approve.click()
    const response = await approvalResponse
    const body = await response.json().catch(() => null)
    if (response.status() !== 200 || body?.workflowStatus !== "approved") {
      throw new Error(
        `ADMIN_REVIEW_LOOP_APPROVAL_FAILED:${JSON.stringify({ body, status: response.status() })}`,
      )
    }
    approvedThroughUi = true
    await page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  }

  const after = await statusOf()
  if (after.status !== "approved") {
    throw new Error(`ADMIN_REVIEW_LOOP_APPROVAL_MISMATCH:${JSON.stringify(after)}`)
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
  const approvedStage = page
    .locator(".gf-operations-dashboard__stage--approved")
    .getByRole("link")
  await approvedStage.waitFor({ state: "visible", timeout: timeoutMs })
  const dashboardApprovedVisible =
    (await approvedStage.locator("strong").innerText()) === "1"
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-approved-dashboard.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/sites"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  const siteCard = page.locator(".gf-sites-workspace__card").filter({
    has: page.getByText(`UI Loop Site ${runId}`, { exact: true }),
  })
  await siteCard.waitFor({ state: "visible", timeout: timeoutMs })
  const siteWorkflowText = await siteCard.locator("dd").filter({ hasText: "approved" }).innerText()
  if (!siteWorkflowText.includes("0 draft · 0 review · 1 approved")) {
    throw new Error(
      `ADMIN_REVIEW_LOOP_SITE_APPROVED_MISMATCH:${JSON.stringify(siteWorkflowText)}`,
    )
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-approved-sites.png"),
    fullPage: true,
  })

  const overflowPx = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  )
  if (!dashboardApprovedVisible) {
    throw new Error("ADMIN_REVIEW_LOOP_DASHBOARD_APPROVED_MISSING")
  }
  if (overflowPx !== 0) {
    throw new Error(`ADMIN_REVIEW_LOOP_OVERFLOW:${overflowPx}`)
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_REVIEW_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    after,
    approvedThroughUi,
    assessmentId: assessment.id,
    assessmentRowText,
    dashboardApprovedVisible,
    hardErrorCount: hardErrors.length,
    overflowPx,
    sitesWorkflowText: siteWorkflowText,
  }
  await writeFile(
    resolve(evidenceDirectory, "review-approval-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

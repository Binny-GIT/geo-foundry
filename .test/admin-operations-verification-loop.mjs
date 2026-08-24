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
const publisherPasswordFile = process.env.ADMIN_UI_PUBLISHER_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_OPERATIONS_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_OPERATIONS_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_OPERATIONS_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) throw new Error("ADMIN_OPERATIONS_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifest = await readManifest({
  root,
  path: resolve(evidenceDirectory, "fixture-manifest.json"),
})
const siteRecord = manifest.records.find((record) => record.collection === "sites")
if (siteRecord === undefined) throw new Error("ADMIN_OPERATIONS_LOOP_SITE_MISSING")
const publishResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "content-service-publish-result.json"), "utf8"),
)
const operationId = publishResult.operationId

const siteName = `UI Loop Site ${runId}`
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

const overflowOf = () =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))

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

  await page.goto(urlOf("/admin"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  const recentOperationsCard = page
    .locator(".gf-operations-dashboard__activity-card")
    .filter({ has: page.getByText("Recent operations", { exact: true }) })
  await recentOperationsCard.waitFor({ state: "visible", timeout: timeoutMs })
  const dashboardOperationLink = recentOperationsCard
    .locator("a")
    .filter({ hasText: "publish · succeeded" })
  await dashboardOperationLink.waitFor({ state: "visible", timeout: timeoutMs })
  const recentOperationsText = await recentOperationsCard.innerText()
  if (!recentOperationsText.toLowerCase().includes("publish · succeeded")) {
    throw new Error(
      `ADMIN_OPERATIONS_LOOP_DASHBOARD_MISMATCH:${JSON.stringify(recentOperationsText)}`,
    )
  }
  const dashboardOperationHref = await dashboardOperationLink.getAttribute("href")
  const documentId = dashboardOperationHref?.split("/").pop()
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new Error("ADMIN_OPERATIONS_LOOP_DOCUMENT_ID_MISSING")
  }
  const dashboardOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "dashboard-recent-operations.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/operations"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  const operationRowLink = page.locator(`a[href="/admin/collections/operations/${documentId}"]`)
  await operationRowLink.waitFor({ state: "visible", timeout: timeoutMs })
  const operationRow = page.locator("table tbody tr").filter({ has: operationRowLink })
  await operationRow.getByText("succeeded", { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const operationRowText = await operationRow.innerText()
  const listOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "operations-list.png"),
    fullPage: true,
  })

  await operationRowLink.click()
  await page.waitForURL(new RegExp(`/admin/collections/operations/${documentId}`), {
    timeout: timeoutMs,
  })
  await page.getByText("succeeded", { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const operationDetailProbe = await page.evaluate(async (id) => {
    const response = await fetch(`/api/operations/${id}?depth=0`, { credentials: "same-origin" })
    const body = await response.json().catch(() => null)
    return {
      operationType: body?.operationType ?? null,
      site: body?.site ?? null,
      state: body?.state ?? null,
      status: response.status,
      tenant: body?.tenant ?? null,
    }
  }, documentId)
  if (
    operationDetailProbe.status !== 200 ||
    operationDetailProbe.state !== "succeeded" ||
    operationDetailProbe.operationType !== "publish" ||
    Number(operationDetailProbe.site) !== siteRecord.id
  ) {
    throw new Error(
      `ADMIN_OPERATIONS_LOOP_DETAIL_MISMATCH:${JSON.stringify(operationDetailProbe)}`,
    )
  }
  const detailOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "operation-detail.png"),
    fullPage: true,
  })

  const overflowPx = Math.max(dashboardOverflowPx, listOverflowPx, detailOverflowPx)
  if (overflowPx !== 0) {
    throw new Error(`ADMIN_OPERATIONS_LOOP_OVERFLOW:${overflowPx}`)
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_OPERATIONS_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    documentId,
    hardErrorCount: hardErrors.length,
    operationDetailProbe,
    operationId,
    operationRowText,
    overflowPx,
    recentOperationsText,
  }
  await writeFile(
    resolve(evidenceDirectory, "operations-verification-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

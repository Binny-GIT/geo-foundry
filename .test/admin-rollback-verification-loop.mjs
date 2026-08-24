#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { chromium } from "@playwright/test"

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
  throw new Error("ADMIN_ROLLBACK_VERIFY_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_ROLLBACK_VERIFY_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_ROLLBACK_VERIFY_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) throw new Error("ADMIN_ROLLBACK_VERIFY_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const consumeResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "rollback-consume-result.json"), "utf8"),
)
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
  const currentReleasesCard = page
    .locator(".gf-operations-dashboard__activity-card")
    .filter({ has: page.getByText("Current releases", { exact: true }) })
  await currentReleasesCard.waitFor({ state: "visible", timeout: timeoutMs })
  await currentReleasesCard.getByText(consumeResult.targetReleaseId, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const currentReleasesText = await currentReleasesCard.innerText()
  const pendingRollbackCard = page
    .locator(".gf-operations-dashboard__activity-card")
    .filter({ has: page.getByText("Pending rollbacks", { exact: true }) })
  await pendingRollbackCard.waitFor({ state: "visible", timeout: timeoutMs })
  const pendingRollbackText = await pendingRollbackCard.innerText()
  if (!pendingRollbackText.includes("No approved rollback intents are waiting")) {
    throw new Error(
      `ADMIN_ROLLBACK_VERIFY_PENDING_NOT_CLEARED:${JSON.stringify(pendingRollbackText)}`,
    )
  }
  const dashboardOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "dashboard-after-rollback.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/sites"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  const siteCard = page.locator(".gf-sites-workspace__card").filter({
    has: page.getByText(siteName, { exact: true }),
  })
  await siteCard.waitFor({ state: "visible", timeout: timeoutMs })
  await siteCard.getByText(consumeResult.targetReleaseId, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const siteReleaseText = await siteCard.locator("dd").filter({ hasText: "rel-" }).innerText()
  const sitesOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "sites-after-rollback.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/releases"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  await page.getByText(consumeResult.targetReleaseId, { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  await page.getByText(consumeResult.sourceReleaseId, { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const releasesTableText = await page.locator("table tbody").innerText()
  const releasesOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "releases-after-rollback.png"),
    fullPage: true,
  })
  if (
    !releasesTableText.toLowerCase().includes("current") ||
    !releasesTableText.toLowerCase().includes("rolled_back")
  ) {
    throw new Error(
      `ADMIN_ROLLBACK_VERIFY_RELEASE_STATES_MISSING:${JSON.stringify(releasesTableText)}`,
    )
  }

  await page.goto(urlOf("/admin/collections/rollback-intents"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  const intentLink = page.getByText(consumeResult.intentId, { exact: true }).first()
  await intentLink.waitFor({ state: "visible", timeout: timeoutMs })
  await intentLink.click()
  await page.waitForURL(/\/admin\/collections\/rollback-intents\/\d+/, { timeout: timeoutMs })
  const intentDetailProbe = await page.evaluate(async (id) => {
    const response = await fetch(
      `/api/rollback-intents?depth=0&limit=1&where[intentId][equals]=${id}`,
      { credentials: "same-origin" },
    )
    const body = await response.json().catch(() => null)
    return { doc: body?.docs?.[0] ?? null, status: response.status }
  }, consumeResult.intentId)
  if (
    intentDetailProbe.status !== 200 ||
    intentDetailProbe.doc === null ||
    typeof intentDetailProbe.doc.consumedAt !== "string"
  ) {
    throw new Error(`ADMIN_ROLLBACK_VERIFY_INTENT_DETAIL_MISMATCH:${JSON.stringify(intentDetailProbe)}`)
  }
  const intentsOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "rollback-intent-detail-consumed.png"),
    fullPage: true,
  })

  const overflowPx = Math.max(
    dashboardOverflowPx,
    sitesOverflowPx,
    releasesOverflowPx,
    intentsOverflowPx,
  )
  if (overflowPx !== 0) throw new Error(`ADMIN_ROLLBACK_VERIFY_OVERFLOW:${overflowPx}`)
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_ROLLBACK_VERIFY_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    consumedAt: intentDetailProbe.doc.consumedAt,
    currentReleasesText,
    hardErrorCount: hardErrors.length,
    overflowPx,
    pendingRollbackText,
    releasesTableText,
    siteReleaseText,
  }
  await writeFile(
    resolve(evidenceDirectory, "rollback-verification-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

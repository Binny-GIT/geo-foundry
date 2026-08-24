#!/usr/bin/env node
// Creates a real rollback intent from the site's real second release back to
// its real first release. The CMS exposes this as a session-authenticated,
// non-internal endpoint (/api/rollback-operations/intents), but no admin UI
// component currently calls it - recorded as a UI coverage gap. The request
// is still made from within the real logged-in publisher browser session
// (page.evaluate fetch), not a bare script call, so it is bound to a real
// cookie/session exactly like every other verified action in this run.
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
  throw new Error("ADMIN_ROLLBACK_CREATE_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_ROLLBACK_CREATE_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_ROLLBACK_CREATE_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) throw new Error("ADMIN_ROLLBACK_CREATE_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const publishResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "content-service-publish-result.json"), "utf8"),
)
const secondPublishResult = JSON.parse(
  await readFile(resolve(evidenceDirectory, "second-edition-publish-result.json"), "utf8"),
)
const siteId = publishResult.siteId
const sourceReleaseId = secondPublishResult.releaseId
const targetReleaseId = publishResult.releaseId

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

  const releaseLookup = await page.evaluate(async (ids) => {
    const fetchOne = async (releaseId) => {
      const response = await fetch(
        `/api/releases?depth=0&limit=1&where[releaseId][equals]=${encodeURIComponent(releaseId)}`,
        { credentials: "same-origin" },
      )
      const body = await response.json().catch(() => null)
      return { doc: body?.docs?.[0] ?? null, status: response.status }
    }
    const [source, target] = await Promise.all([fetchOne(ids.source), fetchOne(ids.target)])
    return { source, target }
  }, { source: sourceReleaseId, target: targetReleaseId })

  if (
    releaseLookup.source.status !== 200 ||
    releaseLookup.target.status !== 200 ||
    releaseLookup.source.doc === null ||
    releaseLookup.target.doc === null
  ) {
    throw new Error(`ADMIN_ROLLBACK_CREATE_LOOKUP_FAILED:${JSON.stringify(releaseLookup)}`)
  }
  if (releaseLookup.source.doc.state !== "current") {
    throw new Error(`ADMIN_ROLLBACK_CREATE_SOURCE_NOT_CURRENT:${releaseLookup.source.doc.state}`)
  }

  const created = await page.evaluate(async (input) => {
    const response = await fetch("/api/rollback-operations/intents", {
      body: JSON.stringify(input.body),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const body = await response.json().catch(() => null)
    return { body, status: response.status }
  }, {
    body: {
      expectedCurrentManifestSha256: releaseLookup.source.doc.manifestSha256,
      expectedCurrentReleaseId: sourceReleaseId,
      expectedManifestSha256: releaseLookup.target.doc.manifestSha256,
      reason: `Verify rollback lifecycle for ${runId}`,
      siteId,
      targetReleaseId,
    },
  })
  if (created.status !== 201 || typeof created.body?.intentId !== "string") {
    throw new Error(`ADMIN_ROLLBACK_CREATE_FAILED:${JSON.stringify(created)}`)
  }
  const intentId = created.body.intentId

  await page.goto(urlOf("/admin/collections/rollback-intents"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  await page.getByText(intentId, { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const listBodyText = await page.locator("table tbody").innerText()
  const listOverflowPx = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  )
  await page.screenshot({
    path: resolve(evidenceDirectory, "rollback-intents-list-with-data.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  const pendingCard = page
    .locator(".gf-operations-dashboard__activity-card")
    .filter({ has: page.getByText("Pending rollbacks", { exact: true }) })
  await pendingCard.waitFor({ state: "visible", timeout: timeoutMs })
  await pendingCard.getByText(intentId, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const pendingText = await pendingCard.innerText()
  const dashboardOverflowPx = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  )
  await page.screenshot({
    path: resolve(evidenceDirectory, "dashboard-pending-rollback.png"),
    fullPage: true,
  })

  const overflowPx = Math.max(listOverflowPx, dashboardOverflowPx)
  if (overflowPx !== 0) throw new Error(`ADMIN_ROLLBACK_CREATE_OVERFLOW:${overflowPx}`)
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_ROLLBACK_CREATE_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    hardErrorCount: hardErrors.length,
    intentId,
    listBodyIncludesIntent: listBodyText.includes(intentId),
    overflowPx,
    pendingText,
    sourceReleaseId,
    targetReleaseId,
    uiCoverageGap: "no admin UI button calls /api/rollback-operations/intents",
  }
  await writeFile(
    resolve(evidenceDirectory, "rollback-intent-create-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

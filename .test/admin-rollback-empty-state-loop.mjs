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
  throw new Error("ADMIN_ROLLBACK_EMPTY_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_ROLLBACK_EMPTY_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_ROLLBACK_EMPTY_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) throw new Error("ADMIN_ROLLBACK_EMPTY_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
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
  const pendingRollbackCard = page
    .locator(".gf-operations-dashboard__activity-card")
    .filter({ has: page.getByText("Pending rollbacks", { exact: true }) })
  await pendingRollbackCard.waitFor({ state: "visible", timeout: timeoutMs })
  const pendingRollbackText = await pendingRollbackCard.innerText()
  const dashboardOverflowPx = await overflowOf()

  await page.goto(urlOf("/admin/collections/rollback-intents"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined)
  const listProbe = await page.evaluate(async () => {
    const response = await fetch(`/api/rollback-intents?depth=0&limit=1&where[intentId][exists]=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return { status: response.status, totalDocs: body?.totalDocs ?? null }
  })
  const bodyText = await page.locator("body").innerText()
  const listOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "rollback-intents-empty.png"),
    fullPage: true,
  })

  const overflowPx = Math.max(dashboardOverflowPx, listOverflowPx)
  if (overflowPx !== 0) {
    throw new Error(`ADMIN_ROLLBACK_EMPTY_LOOP_OVERFLOW:${overflowPx}`)
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_ROLLBACK_EMPTY_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    dataClassification:
      listProbe.status === 200 && listProbe.totalDocs === 0
        ? "EXPECTED_EMPTY"
        : "NEEDS_INVESTIGATION",
    hardErrorCount: hardErrors.length,
    listProbe,
    overflowPx,
    pendingRollbackText,
  }
  await writeFile(
    resolve(evidenceDirectory, "rollback-intents-empty-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
  if (!bodyText.toLowerCase().includes("no results") && listProbe.totalDocs === 0) {
    console.log("NOTE: list page did not show a No Results affordance for a real empty state")
  }
} finally {
  await context.close()
  await browser.close()
}

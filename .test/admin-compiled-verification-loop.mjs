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
  throw new Error("ADMIN_COMPILED_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_COMPILED_LOOP_RUN_ID_REQUIRED")
}
if (typeof publisherPasswordFile !== "string" || publisherPasswordFile.length === 0) {
  throw new Error("ADMIN_COMPILED_LOOP_PASSWORD_FILE_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_COMPILED_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) {
  throw new Error("ADMIN_COMPILED_LOOP_PASSWORD_FILE_EMPTY")
}

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifest = await readManifest({
  root,
  path: resolve(evidenceDirectory, "fixture-manifest.json"),
})
const edition = manifest.records.find((record) => record.collection === "content-editions")
const site = manifest.records.find((record) => record.collection === "sites")
if (edition === undefined || site === undefined) {
  throw new Error("ADMIN_COMPILED_LOOP_RECORDS_MISSING")
}

const title = `UI Loop Edition ${runId}`
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
  await page.goto(urlOf("/admin/login"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
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
  await page
    .getByRole("link", { name: /^Content Editions$/ })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })

  await page.goto(urlOf(`/admin/collections/content-editions/${edition.id}`), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  await page.getByText("compiled", { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const publishButton = page.getByRole("button", {
    name: "Publish edition",
    exact: true,
  })
  await publishButton.waitFor({ state: "visible", timeout: timeoutMs })
  const publishActionVisible = await publishButton.isVisible()
  const editionProbe = await page.evaluate(async (id) => {
    const response = await fetch(`/api/content-editions/${id}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      compiledRelease: body?.compiledRelease ?? null,
      id: body?.id ?? null,
      revision: body?.workflowRevision ?? null,
      site: body?.site ?? null,
      status: response.status,
      title: body?.title ?? null,
      workflowStatus: body?.workflowStatus ?? null,
    }
  }, edition.id)
  if (
    editionProbe.status !== 200 ||
    Number(editionProbe.id) !== Number(edition.id) ||
    Number(editionProbe.site) !== Number(site.id) ||
    editionProbe.title !== title ||
    editionProbe.workflowStatus !== "compiled" ||
    typeof editionProbe.compiledRelease !== "string" ||
    !editionProbe.compiledRelease.startsWith("rel-") ||
    Number(editionProbe.revision) !== 7
  ) {
    throw new Error(`ADMIN_COMPILED_LOOP_DETAIL_MISMATCH:${JSON.stringify(editionProbe)}`)
  }
  const detailOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-compiled.png"),
    fullPage: true,
  })

  await page.goto(urlOf("/admin/collections/content-editions"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.locator("table").waitFor({ state: "visible", timeout: timeoutMs })
  const editionLink = page.locator(
    `a[href="/admin/collections/content-editions/${edition.id}"]`,
  )
  await editionLink.waitFor({ state: "visible", timeout: timeoutMs })
  const editionRow = page.locator("table tbody tr").filter({ has: editionLink })
  await editionRow.getByText("compiled", { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  await editionRow.getByText(siteName, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const editionRowText = await editionRow.innerText()
  if (
    !editionRowText.includes(title) ||
    !editionRowText.includes(siteName) ||
    !editionRowText.toLowerCase().includes("compiled")
  ) {
    throw new Error(`ADMIN_COMPILED_LOOP_LIST_MISMATCH:${JSON.stringify(editionRowText)}`)
  }
  const listOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-compiled-list.png"),
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
  const compiledStage = page
    .locator(".gf-operations-dashboard__stage--compiled")
    .getByRole("link")
  await compiledStage.waitFor({ state: "visible", timeout: timeoutMs })
  const compiledStageCount = await compiledStage.locator("strong").innerText()
  const readyPanel = page
    .locator(".gf-operations-dashboard__queue-card")
    .filter({ has: page.getByText("Ready to publish", { exact: true }) })
  await readyPanel.waitFor({ state: "visible", timeout: timeoutMs })
  const readyPanelText = await readyPanel.innerText()
  if (compiledStageCount !== "1" || !readyPanelText.includes(title)) {
    throw new Error(
      `ADMIN_COMPILED_LOOP_DASHBOARD_MISMATCH:${JSON.stringify({ compiledStageCount, readyPanelText })}`,
    )
  }
  const dashboardOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-compiled-dashboard.png"),
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
  const siteWorkflowText = await siteCard.locator("dd").filter({ hasText: "compiled" }).innerText()
  if (
    !siteWorkflowText.includes(
      "0 draft · 0 review · 0 approved · 1 compiled · 0 published",
    )
  ) {
    throw new Error(
      `ADMIN_COMPILED_LOOP_SITE_MISMATCH:${JSON.stringify(siteWorkflowText)}`,
    )
  }
  const sitesOverflowPx = await overflowOf()
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-compiled-sites.png"),
    fullPage: true,
  })

  const overflowPx = Math.max(
    detailOverflowPx,
    listOverflowPx,
    dashboardOverflowPx,
    sitesOverflowPx,
  )
  if (overflowPx !== 0) {
    throw new Error(`ADMIN_COMPILED_LOOP_OVERFLOW:${overflowPx}`)
  }
  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_COMPILED_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    compiledRelease: editionProbe.compiledRelease,
    compiledStageCount,
    editionId: edition.id,
    editionRowText,
    hardErrorCount: hardErrors.length,
    overflowPx,
    publishActionVisible,
    readyPanelText,
    revision: editionProbe.revision,
    siteWorkflowText,
    workflowStatus: editionProbe.workflowStatus,
  }
  await writeFile(
    resolve(evidenceDirectory, "compiled-verification-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

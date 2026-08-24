#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
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
const passwordFile = process.env.ADMIN_UI_EDITOR_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_EDITION_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_EDITION_LOOP_RUN_ID_REQUIRED")
}
if (typeof passwordFile !== "string" || passwordFile.length === 0) {
  throw new Error("ADMIN_EDITION_LOOP_PASSWORD_FILE_REQUIRED")
}

const passwordMetadata = await stat(passwordFile)
if (
  passwordMetadata.uid !== process.getuid() ||
  (passwordMetadata.mode & 0o077) !== 0
) {
  throw new Error("ADMIN_EDITION_LOOP_PASSWORD_FILE_INSECURE")
}
const password = (await readFile(passwordFile, "utf8")).trim()
if (password.length === 0) {
  throw new Error("ADMIN_EDITION_LOOP_PASSWORD_FILE_EMPTY")
}

const manifestPath = resolve(
  root,
  ".test",
  "admin-ui-evidence",
  runId,
  "fixture-manifest.json",
)
let manifest = await readManifest({ root, path: manifestPath })
const recordOf = (collection) =>
  manifest.records.find((record) => record.collection === collection)
const content = recordOf("contents")
const site = recordOf("sites")
const tenant = recordOf("tenants")
if (content === undefined || site === undefined || tenant === undefined) {
  throw new Error("ADMIN_EDITION_LOOP_UPSTREAM_RECORDS_MISSING")
}

const title = `UI Loop Edition ${runId}`
const angle = `Browser data closure ${runId}`
const summary =
  "A minimal browser-created draft used to verify tenant-scoped content workflow."
const paragraph =
  `This browser-created paragraph closes the Content Edition data loop for ${runId}.`
const email = `ui-loop-editor-${runId}@geo-foundry.test`
const contentLabel = `UI Loop Content ${runId}`
const siteLabel = `UI Loop Site ${runId}`
const evidenceDirectory = resolve(
  root,
  ".test",
  "admin-ui-evidence",
  runId,
)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
const page = await context.newPage()
const hardErrors = []
const siteRequests = []
page.on("response", async (response) => {
  if (response.url().includes(`/api/sites/${site.id}?depth=0`)) {
    const body = await response.json().catch(() => null)
    siteRequests.push({
      id: body?.id ?? null,
      name: body?.name ?? null,
      status: response.status(),
    })
  }
})
page.on("console", (message) => {
  if (message.type() === "error" && !/favicon/i.test(message.text())) {
    hardErrors.push(message.text())
  }
})
page.on("pageerror", (error) => hardErrors.push(String(error)))

const urlOf = (route) => new URL(route, baseUrl).toString()
const selectRelationship = async (fieldId, label) => {
  const input = page.locator(`${fieldId} input[role="combobox"]`)
  await input.fill(label)
  const option = page.getByRole("option", { name: label, exact: true })
  await option.waitFor({ state: "visible", timeout: timeoutMs })
  await option.click()
}

const verifyEdition = async (id) => {
  const result = await page.evaluate(async (editionId) => {
    const response = await fetch(`/api/content-editions/${editionId}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return { body, status: response.status }
  }, id)
  if (result.status !== 200 || result.body === null) {
    throw new Error(`ADMIN_EDITION_LOOP_VERIFY_FAILED:${result.status}`)
  }
  const body = result.body
  const firstBlock = Array.isArray(body.body) ? body.body[0] : null
  const checks = {
    body:
      firstBlock?.blockType === "paragraph" &&
      firstBlock?.text === paragraph,
    content: Number(body.content) === Number(content.id),
    site: Number(body.site) === Number(site.id),
    tenant: Number(body.tenant) === Number(tenant.id),
    title: body.title === title,
    workflowStatus: body.workflowStatus === "draft",
  }
  if (Object.values(checks).some((passed) => !passed)) {
    throw new Error(`ADMIN_EDITION_LOOP_DATA_MISMATCH:${JSON.stringify(checks)}`)
  }
  return { checks, id: Number(body.id), workflowStatus: body.workflowStatus }
}

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

  const existing = await page.evaluate(async (editionTitle) => {
    const query = new URLSearchParams({
      depth: "0",
      draft: "true",
      limit: "2",
      "where[title][equals]": editionTitle,
    })
    const response = await fetch(`/api/content-editions?${query}`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      docs: Array.isArray(body?.docs) ? body.docs : [],
      status: response.status,
    }
  }, title)
  if (existing.status !== 200) {
    throw new Error(`ADMIN_EDITION_LOOP_EXISTING_QUERY_FAILED:${existing.status}`)
  }

  let editionId
  let createdThroughUi = false
  if (existing.docs.length > 0) {
    editionId = Number(existing.docs[0].id)
  } else {
    await page.goto(urlOf("/admin/collections/content-editions/create"), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    })
    await page
      .getByRole("heading", { name: "[Untitled]" })
      .waitFor({ state: "visible", timeout: timeoutMs })

    await selectRelationship("#field-content", contentLabel)
    await selectRelationship("#field-site", siteLabel)
    await page.locator('input[name="angle"]').fill(angle)
    await page.locator('input[name="title"]').fill(title)
    await page.locator('textarea[name="summary"]').fill(summary)
    await page.locator('input[name="primaryTopic"]').fill("browser-testing")

    await page.getByRole("button", { name: "Add Body", exact: true }).click()
    await page.getByRole("button", { name: "Paragraph", exact: true }).click()
    const paragraphField = page.locator('textarea[name="body.0.text"]')
    await paragraphField.waitFor({ state: "visible", timeout: timeoutMs })
    await paragraphField.fill(paragraph)

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/content-editions"),
      { timeout: timeoutMs },
    )
    await page.locator("#action-save-draft").click()
    const response = await createResponse
    const responseBody = await response.json().catch(() => null)
    if (response.status() < 200 || response.status() >= 300) {
      throw new Error(`ADMIN_EDITION_LOOP_CREATE_FAILED:${response.status()}`)
    }
    editionId = Number(responseBody?.doc?.id ?? responseBody?.id)
    if (!Number.isInteger(editionId) || editionId <= 0) {
      await page.waitForURL(/\/admin\/collections\/content-editions\/\d+/, {
        timeout: timeoutMs,
      })
      editionId = Number(/content-editions\/(\d+)/.exec(page.url())?.[1])
    }
    createdThroughUi = true
  }

  const verified = await verifyEdition(editionId)
  const alreadyTracked = manifest.records.some(
    (record) =>
      record.collection === "content-editions" && record.id === editionId,
  )
  if (!alreadyTracked) {
    manifest = trackRecord(manifest, {
      collection: "content-editions",
      createdAt: new Date().toISOString(),
      id: editionId,
      marker: title,
      parentId: content.id,
      tenantId: tenant.id,
    })
    await writeManifest({ root, manifest, path: manifestPath })
  }

  await page.goto(
    urlOf(`/admin/collections/content-editions/${editionId}`),
    { timeout: timeoutMs, waitUntil: "domcontentloaded" },
  )
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {})
  const contentValue = page.locator("#field-content .value-container")
  const siteValue = page.locator("#field-site .value-container")
  await contentValue.getByText(contentLabel, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  await siteValue.getByText(siteLabel, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })

  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-created.png"),
    fullPage: true,
  })
  const layout = await page.evaluate(() => {
    const viewportWidth = window.innerWidth
    const overflowElements = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          ariaHidden: element.getAttribute("aria-hidden"),
          className: typeof element.className === "string" ? element.className : "",
          display: style.display,
          id: element.id,
          opacity: style.opacity,
          position: style.position,
          right: Math.round(rect.right * 100) / 100,
          scrollWidth: element.scrollWidth,
          tag: element.tagName,
          visibility: style.visibility,
          width: Math.round(rect.width * 100) / 100,
        }
      })
      .filter(
        (entry) =>
          entry.right > viewportWidth + 1 ||
          entry.scrollWidth > entry.width + 1,
      )
      .slice(0, 30)
    return {
      overflowElements,
      overflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - viewportWidth,
      ),
    }
  })

  await page.goto(urlOf("/admin/collections/content-editions"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByRole("link", { name: title, exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const editionRow = page
    .locator("table tbody tr")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) })
  await editionRow.getByText(siteLabel, { exact: true }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const editionRowText = await editionRow.innerText()
  const siteProbe = await page.evaluate(async (siteId) => {
    const response = await fetch(`/api/sites/${siteId}?depth=0`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return {
      id: body?.id ?? null,
      name: body?.name ?? null,
      status: response.status,
      tenant: body?.tenant ?? null,
    }
  }, site.id)
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-list.png"),
    fullPage: true,
  })
  if (
    !editionRowText.includes(siteLabel) ||
    !editionRowText.toLowerCase().includes("draft")
  ) {
    throw new Error(
      `ADMIN_EDITION_LOOP_LIST_DATA_MISMATCH:${JSON.stringify({ editionRowText, siteProbe, siteRequests })}`,
    )
  }

  await page.goto(urlOf("/admin/collections/sites"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByText(siteLabel, { exact: true }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const sitesBody = await page.locator("body").innerText()
  const siteWorkflowVisible =
    sitesBody.includes(siteLabel) && sitesBody.includes("1 draft")
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-sites-workspace.png"),
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
  const dashboardBody = await page.locator("body").innerText()
  const dashboardDraftVisible = dashboardBody.toLowerCase().includes("draft")
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-dashboard.png"),
    fullPage: true,
  })

  if (layout.overflowPx !== 0) {
    throw new Error(
      `ADMIN_EDITION_LOOP_OVERFLOW:${JSON.stringify(layout)}`,
    )
  }
  if (!siteWorkflowVisible) {
    throw new Error("ADMIN_EDITION_LOOP_SITE_DRAFT_MISSING")
  }
  if (!dashboardDraftVisible) {
    throw new Error("ADMIN_EDITION_LOOP_DASHBOARD_DRAFT_MISSING")
  }

  const result = {
    createdThroughUi,
    dashboardDraftVisible,
    editionId,
    editionRowText,
    hardErrorCount: hardErrors.length,
    layout,
    siteWorkflowVisible,
    verified,
  }
  await writeFile(
    resolve(evidenceDirectory, "content-edition-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

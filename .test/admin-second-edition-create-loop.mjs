#!/usr/bin/env node
// Creates a second real Content + Content Edition on the same run Site, then
// drives it through generating -> review as the editor, so a second real
// release can later be compiled/published/rolled back for Rollback Intent
// verification. Reuses the exact patterns already verified for edition 1.
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

import { readManifest, trackRecord, writeManifest } from "./admin-fixture-manifest.mjs"

const root = resolve(import.meta.dirname, "..")
const runId = process.env.ADMIN_UI_RUN_ID
const baseUrl = new URL(
  process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com",
)
const editorPasswordFile = process.env.ADMIN_UI_EDITOR_PASSWORD_FILE
const timeoutMs = 90_000

if (
  baseUrl.protocol !== "https:" ||
  baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com"
) {
  throw new Error("ADMIN_SECOND_EDITION_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_SECOND_EDITION_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(editorPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_SECOND_EDITION_LOOP_PASSWORD_FILE_INSECURE")
}
const editorPassword = (await readFile(editorPasswordFile, "utf8")).trim()
if (editorPassword.length === 0) throw new Error("ADMIN_SECOND_EDITION_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifestPath = resolve(evidenceDirectory, "fixture-manifest.json")
let manifest = await readManifest({ root, path: manifestPath })
const site = manifest.records.find((record) => record.collection === "sites")
const tenant = manifest.records.find((record) => record.collection === "tenants")
if (site === undefined || tenant === undefined) {
  throw new Error("ADMIN_SECOND_EDITION_LOOP_UPSTREAM_RECORDS_MISSING")
}

const contentTopic = `UI Loop Content 2 ${runId}`
const title = `UI Loop Edition 2 ${runId}`
const angle = `Second release cycle ${runId}`
const summary = "A second edition used to exercise a real second release for rollback testing."
const paragraph = `This paragraph produces the second real release for ${runId}.`
const email = `ui-loop-editor-${runId}@geo-foundry.test`
const siteLabel = `UI Loop Site ${runId}`

const urlOf = (route) => new URL(route, baseUrl).toString()
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
const page = await context.newPage()
const hardErrors = []
page.on("console", (message) => {
  if (message.type() !== "error" || /favicon/i.test(message.text())) return
  hardErrors.push(message.text())
})
page.on("pageerror", (error) => hardErrors.push(String(error)))

const selectRelationship = async (fieldId, label) => {
  const input = page.locator(`${fieldId} input[role="combobox"]`)
  await input.fill(label)
  const option = page.getByRole("option", { name: label, exact: true })
  await option.waitFor({ state: "visible", timeout: timeoutMs })
  await option.click()
}

const workflowStatus = async (editionId) =>
  page.evaluate(async (id) => {
    const response = await fetch(`/api/content-editions/${id}?depth=0&draft=true`, {
      credentials: "same-origin",
    })
    const body = await response.json().catch(() => null)
    return { revision: body?.workflowRevision ?? null, status: body?.workflowStatus ?? null }
  }, editionId)

try {
  await page.goto(urlOf("/admin/login"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  await page.locator('input[name="email"], input[type="email"]').first().fill(email)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(editorPassword)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })

  const existingContent = await page.evaluate(async (topic) => {
    const query = new URLSearchParams({ depth: "0", limit: "2", "where[topic][equals]": topic })
    const response = await fetch(`/api/contents?${query}`, { credentials: "same-origin" })
    const body = await response.json().catch(() => null)
    return { docs: Array.isArray(body?.docs) ? body.docs : [], status: response.status }
  }, contentTopic)
  if (existingContent.status !== 200) {
    throw new Error(`ADMIN_SECOND_EDITION_LOOP_CONTENT_QUERY_FAILED:${existingContent.status}`)
  }
  let contentId
  if (existingContent.docs.length > 0) {
    contentId = Number(existingContent.docs[0].id)
  } else {
    await page.goto(urlOf("/admin/collections/contents/create"), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    })
    await page.locator('input[name="topic"]').fill(contentTopic)
    await page.locator('input[name="intent"]').fill("Exercise a second real release for rollback")
    const createContentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/api/contents"),
      { timeout: timeoutMs },
    )
    await page.locator("#action-save").click()
    const response = await createContentResponse
    const body = await response.json().catch(() => null)
    if (response.status() < 200 || response.status() >= 300) {
      throw new Error(`ADMIN_SECOND_EDITION_LOOP_CONTENT_CREATE_FAILED:${response.status()}`)
    }
    contentId = Number(body?.doc?.id ?? body?.id)
  }
  if (!Number.isInteger(contentId) || contentId <= 0) {
    throw new Error("ADMIN_SECOND_EDITION_LOOP_CONTENT_ID_INVALID")
  }
  if (!manifest.records.some((r) => r.collection === "contents" && r.id === contentId)) {
    manifest = trackRecord(manifest, {
      collection: "contents",
      createdAt: new Date().toISOString(),
      id: contentId,
      marker: contentTopic,
      parentId: tenant.id,
      tenantId: tenant.id,
    })
    await writeManifest({ root, manifest, path: manifestPath })
  }

  const existingEdition = await page.evaluate(async (editionTitle) => {
    const query = new URLSearchParams({
      depth: "0",
      draft: "true",
      limit: "2",
      "where[title][equals]": editionTitle,
    })
    const response = await fetch(`/api/content-editions?${query}`, { credentials: "same-origin" })
    const body = await response.json().catch(() => null)
    return { docs: Array.isArray(body?.docs) ? body.docs : [], status: response.status }
  }, title)
  if (existingEdition.status !== 200) {
    throw new Error(`ADMIN_SECOND_EDITION_LOOP_EDITION_QUERY_FAILED:${existingEdition.status}`)
  }
  let editionId
  if (existingEdition.docs.length > 0) {
    editionId = Number(existingEdition.docs[0].id)
  } else {
    await page.goto(urlOf("/admin/collections/content-editions/create"), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    })
    await page
      .getByRole("heading", { name: "[Untitled]" })
      .waitFor({ state: "visible", timeout: timeoutMs })
    await selectRelationship("#field-content", contentTopic)
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

    const createEditionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/content-editions"),
      { timeout: timeoutMs },
    )
    await page.locator("#action-save-draft").click()
    const response = await createEditionResponse
    const body = await response.json().catch(() => null)
    if (response.status() < 200 || response.status() >= 300) {
      throw new Error(`ADMIN_SECOND_EDITION_LOOP_EDITION_CREATE_FAILED:${response.status()}`)
    }
    editionId = Number(body?.doc?.id ?? body?.id)
    if (!Number.isInteger(editionId) || editionId <= 0) {
      await page.waitForURL(/\/admin\/collections\/content-editions\/\d+/, { timeout: timeoutMs })
      editionId = Number(/content-editions\/(\d+)/.exec(page.url())?.[1])
    }
  }
  if (!Number.isInteger(editionId) || editionId <= 0) {
    throw new Error("ADMIN_SECOND_EDITION_LOOP_EDITION_ID_INVALID")
  }
  if (
    !manifest.records.some((r) => r.collection === "content-editions" && r.id === editionId)
  ) {
    manifest = trackRecord(manifest, {
      collection: "content-editions",
      createdAt: new Date().toISOString(),
      id: editionId,
      marker: title,
      parentId: contentId,
      tenantId: tenant.id,
    })
    await writeManifest({ root, manifest, path: manifestPath })
  }

  await page.goto(urlOf(`/admin/collections/content-editions/${editionId}`), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })

  const initial = await workflowStatus(editionId)
  if (initial.status === "draft") {
    const startButton = page.getByRole("button", { name: "Start generation", exact: true })
    await startButton.waitFor({ state: "visible", timeout: timeoutMs })
    const generatingResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
      { timeout: timeoutMs },
    )
    await startButton.click()
    const generating = await generatingResponse
    if (generating.status() !== 200) {
      throw new Error(`ADMIN_SECOND_EDITION_LOOP_GENERATING_FAILED:${generating.status()}`)
    }
    await page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  }
  const afterGenerating = await workflowStatus(editionId)
  if (afterGenerating.status === "generating") {
    const submitButton = page.getByRole("button", { name: "Submit for review", exact: true })
    await submitButton.waitFor({ state: "visible", timeout: timeoutMs })
    const reviewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/editions/${editionId}/workflow-transitions`),
      { timeout: timeoutMs },
    )
    await submitButton.click()
    const review = await reviewResponse
    if (review.status() !== 200) {
      throw new Error(`ADMIN_SECOND_EDITION_LOOP_REVIEW_FAILED:${review.status()}`)
    }
    await page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" })
  }
  const finalStatus = await workflowStatus(editionId)
  if (finalStatus.status !== "review") {
    throw new Error(`ADMIN_SECOND_EDITION_LOOP_FINAL_STATE_INVALID:${JSON.stringify(finalStatus)}`)
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, "second-edition-review.png"),
    fullPage: true,
  })

  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_SECOND_EDITION_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    contentId,
    editionId,
    hardErrorCount: hardErrors.length,
    title,
    workflowStatus: finalStatus.status,
  }
  await writeFile(
    resolve(evidenceDirectory, "second-edition-create-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

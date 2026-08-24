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
  throw new Error("ADMIN_PUBLISH_LOOP_BASE_URL_FORBIDDEN")
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("ADMIN_PUBLISH_LOOP_RUN_ID_REQUIRED")
}
const passwordMetadata = await stat(publisherPasswordFile)
if (passwordMetadata.uid !== process.getuid() || (passwordMetadata.mode & 0o077) !== 0) {
  throw new Error("ADMIN_PUBLISH_LOOP_PASSWORD_FILE_INSECURE")
}
const publisherPassword = (await readFile(publisherPasswordFile, "utf8")).trim()
if (publisherPassword.length === 0) throw new Error("ADMIN_PUBLISH_LOOP_PASSWORD_FILE_EMPTY")

const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const manifest = await readManifest({
  root,
  path: resolve(evidenceDirectory, "fixture-manifest.json"),
})
const edition = manifest.records.find((record) => record.collection === "content-editions")
if (edition === undefined) throw new Error("ADMIN_PUBLISH_LOOP_EDITION_MISSING")

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

  await page.goto(urlOf(`/admin/collections/content-editions/${edition.id}`), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  })
  await page.getByRole("heading", { name: title }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  })
  const publishButton = page.getByRole("button", { name: "Publish edition", exact: true })
  await publishButton.waitFor({ state: "visible", timeout: timeoutMs })

  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/editions/${edition.id}/publish-operations`),
    { timeout: timeoutMs },
  )
  await publishButton.click()
  const response = await publishResponse
  const body = await response.json().catch(() => null)
  if (response.status() !== 200 && response.status() !== 202) {
    throw new Error(
      `ADMIN_PUBLISH_LOOP_SUBMIT_FAILED:${JSON.stringify({ body, status: response.status() })}`,
    )
  }
  const operation = body?.operation
  if (
    typeof operation?.operationId !== "string" ||
    typeof operation?.releaseId !== "string" ||
    operation.state !== "queued"
  ) {
    throw new Error(`ADMIN_PUBLISH_LOOP_OPERATION_INVALID:${JSON.stringify(body)}`)
  }
  await page
    .getByText("Publish requested. It will complete in the background.", { exact: true })
    .waitFor({ state: "visible", timeout: timeoutMs })
  await page.screenshot({
    path: resolve(evidenceDirectory, "content-edition-publish-requested.png"),
    fullPage: true,
  })

  if (hardErrors.length > 0) {
    throw new Error(`ADMIN_PUBLISH_LOOP_BROWSER_ERRORS:${JSON.stringify(hardErrors)}`)
  }

  const result = {
    created: Boolean(body.editionId) && response.status() === 202,
    editionId: edition.id,
    hardErrorCount: hardErrors.length,
    operationId: operation.operationId,
    releaseId: operation.releaseId,
    state: operation.state,
    status: response.status(),
  }
  await writeFile(
    resolve(evidenceDirectory, "publisher-publish-submission.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  console.log(JSON.stringify(result))
} finally {
  await context.close()
  await browser.close()
}

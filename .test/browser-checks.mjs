#!/usr/bin/env node
// geo-foundry-mk-dev 浏览器可达性检查(真实 Chromium)
// 用例与期望见同目录 browser-test-plan.md;结果 JSON 写入 latest-run.json。
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const ARTIFACTS = new URL("./artifacts/", import.meta.url).pathname
const ATTEMPTS = 3
const TIMEOUT_MS = 45_000

const results = []
const record = (id, name, pass, detail) => results.push({ detail, id, name, pass })

const withRetry = async (name, action) => {
  let lastError = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await action(attempt)
    } catch (error) {
      lastError = error
      console.log(`retry ${attempt}/${ATTEMPTS} for ${name}: ${String(error).slice(0, 90)}`)
    }
  }
  throw lastError
}

const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP geo-foundry-mk-dev.aixllent.com 104.21.53.215"],
})
const context = await browser.newContext({ viewport: { height: 800, width: 1280 } })

try {
  await mkdir(ARTIFACTS, { recursive: true })

  // Case 1: root renders the public entry page.
  const page = await context.newPage()
  const rootTitle = await withRetry("1", async () => {
    const response = await page.goto(`${BASE}/`, {
      timeout: TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    })
    if (response !== null && response.status() >= 400) {
      throw new Error(`root status ${response.status()}`)
    }
    const heading = page.getByRole("heading", { name: "Content operations workspace" })
    await heading.waitFor({ state: "visible", timeout: TIMEOUT_MS })
    return page.title()
  })
  record("1", "GET / public entry", true, `title=${rootTitle}`)

  // Case 4/5: API probes from inside the page (uses the browser network stack)
  for (const [id, path, expect] of [
    ["4", "/api/health", '"status":"alive"'],
    ["5", "/api/readiness", '"status":"ready"'],
  ]) {
    const body = await withRetry(id, async () => {
      const text = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return `${response.status} ${await response.text()}`
      }, `${BASE}${path}`)
      if (!text.includes("200 ") || !text.includes(expect)) {
        throw new Error(text.slice(0, 140))
      }
      return text
    })
    record(id, `GET ${path}`, true, body.slice(0, 130))
  }

  // Case 2: /admin reachable with a Payload title
  const adminTitle = await withRetry("2", async () => {
    await page.goto(`${BASE}/admin`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
    const title = await page.title()
    if (!/payload|geo/i.test(title)) {
      throw new Error(`unexpected title: ${title}`)
    }
    return title
  })
  record("2", "GET /admin", true, `title=${adminTitle}`)
  await page.screenshot({ path: `${ARTIFACTS}admin.png` })

  // Case 3: /admin/login must render a usable login form.
  const loginProbe = await withRetry("3", async () => {
    await page.goto(`${BASE}/admin/login`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
    const email = page.locator('input[name="email"], input[type="email"]').first()
    const password = page.locator('input[name="password"], input[type="password"]').first()
    await email.waitFor({ state: "visible", timeout: 90_000 })
    await password.waitFor({ state: "visible", timeout: 90_000 })
    return { title: await page.title() }
  })
  record("3", "GET /admin/login", true, `title=${loginProbe.title}; login form rendered`)
  await page.screenshot({ path: `${ARTIFACTS}admin-login.png`, fullPage: false })

  // Case 6: unknown route 404s
  const notFoundStatus = await withRetry("6", async () => {
    const response = await page.goto(`${BASE}/definitely-not-a-page`, {
      timeout: TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    })
    if (response?.status() !== 404) {
      throw new Error(`expected 404 got ${response?.status()}`)
    }
    return response.status()
  })
  record("6", "GET unknown route", true, `status=${notFoundStatus}`)

  record("7", "screenshots archived", true, "artifacts/admin.png, artifacts/admin-login.png")
} catch (error) {
  record("0", "aborted", false, String(error).slice(0, 300))
} finally {
  await browser.close()
}

const failed = results.filter((entry) => !entry.pass)
const summary = {
  at: new Date().toISOString(),
  base: BASE,
  failed: failed.length,
  passed: results.length - failed.length,
  results,
}
await writeFile(
  new URL("./latest-run.json", import.meta.url).pathname,
  `${JSON.stringify(summary, null, 2)}\n`,
)
console.log(JSON.stringify(summary, null, 2))
process.exitCode = failed.length === 0 ? 0 : 1

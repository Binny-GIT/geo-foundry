#!/usr/bin/env node
// 诊断：捕获管理端页面中所有失败的请求 URL（定位 ERR_CONNECTION_REFUSED 来源）
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP geo-foundry-mk-dev.aixllent.com 104.21.53.215"],
})
const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
const page = await context.newPage()

const failures = []
page.on("requestfailed", (request) => {
  failures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`)
})
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`console.error: ${msg.text().slice(0, 200)}`)
})

const goto = async (path, label) => {
  failures.length = 0
  console.log(`\n=== ${label} (${path}) ===`)
  await page.goto(`${BASE}${path}`, { timeout: 60_000, waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  if (failures.length === 0) console.log("  (no failed requests)")
  for (const f of failures) console.log(`  FAIL ${f}`)
}

// 登录
await goto("/admin/login", "login page (anon)")
await page.locator('input[name="email"]').first().fill("embed-boot@geo-foundry.test")
await page.locator('input[name="password"]').first().fill("bootstrap-password-260818")
await page.getByRole("button", { name: /login/i }).first().click()
await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
await page.waitForTimeout(2500)
failures.length = 0
console.log("\n=== dashboard (after login, same page) ===")
if (failures.length === 0) console.log("  (no failed requests so far this page)")
for (const f of failures) console.log(`  FAIL ${f}`)

await goto("/admin/collections/users", "users list")
await goto("/admin/collections/contents", "contents list")

// 打开第一篇 contents 文档
await page.locator("table tbody tr a").first().click()
await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
await page.waitForTimeout(3000)
console.log("\n=== first contents document ===")
if (failures.length === 0) console.log("  (no failed requests)")
for (const f of failures) console.log(`  FAIL ${f}`)

await goto("/admin/collections/content-editions", "content-editions list")
const editionRow = page.locator("table tbody tr a").first()
if ((await editionRow.count()) > 0) {
  await editionRow.click()
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(3000)
  console.log("\n=== first content-edition document ===")
  if (failures.length === 0) console.log("  (no failed requests)")
  for (const f of failures) console.log(`  FAIL ${f}`)
}

await browser.close()

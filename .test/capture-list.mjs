#!/usr/bin/env node
// 抓用户指出的 sites 列表页（含表格），验证表格精修效果。存 artifacts/list-*.png。
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const OUT = new URL("./artifacts/", import.meta.url).pathname
const SUPER = { email: "embed-boot@geo-foundry.test", password: "bootstrap-password-260818" }

const login = async (page) => {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator('input[name="email"]').first().waitFor({ state: "visible", timeout: 90_000 })
  await page.locator('input[name="email"]').first().fill(SUPER.email)
  await page.locator('input[name="password"]').first().fill(SUPER.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: 90_000 })
}

const run = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await login(page)
  for (const [url, name] of [
    ["/admin/collections/sites?depth=1&limit=10", "list-sites"],
    ["/admin/collections/users?depth=1&limit=10", "list-users"],
  ]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {})
    await page.waitForTimeout(3500)
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true })
    console.log(`saved ${name}.png`)
  }
  await browser.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

#!/usr/bin/env node
// 抓一组代表性整页截图用于系统页面盘点（宿主侧 Playwright，存 artifacts/ov-*.png）。
import { mkdir } from "node:fs/promises"
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const OUT = new URL("./artifacts/", import.meta.url).pathname
const SUPER = { email: "embed-boot@geo-foundry.test", password: "bootstrap-password-260818" }

const login = async (page) => {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator('input[name="email"], input[type="email"]').first().waitFor({ state: "visible", timeout: 90_000 })
  await page.locator('input[name="email"], input[type="email"]').first().fill(SUPER.email)
  await page.locator('input[name="password"], input[type="password"]').first().fill(SUPER.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
  // 严格确认会话已建立：Dashboard 侧栏出现
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: 90_000 })
}

const shot = async (page, url, name) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {})
  await page.waitForTimeout(2_500)
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true })
  console.log(`saved ${name}.png  <-  ${url}`)
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  await shot(page, "/", "ov-01-homepage")
  await shot(page, "/admin/login", "ov-02-login")
  await login(page)
  await shot(page, "/admin", "ov-03-dashboard")
  await shot(page, "/admin/collections/contents", "ov-04-contents-list")
  await shot(page, "/admin/collections/contents/580", "ov-05-content-doc")
  await shot(page, "/admin/collections/content-editions/540", "ov-06-edition-doc")
  await shot(page, "/admin/collections/sites/create", "ov-07-site-create")
  await shot(page, "/admin/collections/domains", "ov-08-domains-empty")

  await browser.close()
  console.log("done")
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

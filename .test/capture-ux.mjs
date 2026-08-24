#!/usr/bin/env node
// UX 视角截图：错误态/空态/被拒态/表单/受限文档/移动端。宿主侧 Playwright，存 artifacts/ux-*.png。
import { mkdir } from "node:fs/promises"
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const OUT = new URL("./artifacts/", import.meta.url).pathname
const SUPER = { email: "embed-boot@geo-foundry.test", password: "bootstrap-password-260818" }
const EDITOR = { email: "embed-editor@geo-foundry.test", password: "pw-1-editor" }

const login = async (page, acct) => {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator('input[name="email"], input[type="email"]').first().waitFor({ state: "visible", timeout: 90_000 })
  await page.locator('input[name="email"], input[type="email"]').first().fill(acct.email)
  await page.locator('input[name="password"], input[type="password"]').first().fill(acct.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: 90_000 })
}

const shot = async (page, name) => {
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true })
  console.log(`saved ${name}.png`)
}

const goShot = async (page, url, name) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {})
  await shot(page, name)
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()

  // 1) 登录错误态：填错密码提交，看反馈
  const c0 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p0 = await c0.newPage()
  await p0.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await p0.locator('input[type="email"]').first().fill(SUPER.email)
  await p0.locator('input[type="password"]').first().fill("wrong-password-xxx")
  await p0.getByRole("button", { name: /login/i }).first().click()
  await p0.waitForTimeout(6_000)
  await shot(p0, "ux-01-login-error")
  await c0.close()

  // 2) super-admin：被拒创建页（sites create）+ 空集合列表空状态
  const c1 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p1 = await c1.newPage()
  await login(p1, SUPER)
  await goShot(p1, "/admin/collections/sites/create", "ux-02-create-denied")
  await goShot(p1, "/admin/collections/domains", "ux-03-empty-list")
  await goShot(p1, "/admin/collections/media", "ux-04-media-empty")
  await c1.close()

  // 3) editor：创建表单 + 受限文档（Untitled tenant）+ 移动端
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p2 = await c2.newPage()
  await login(p2, EDITOR)
  await goShot(p2, "/admin/collections/contents/create", "ux-05-create-form")
  await goShot(p2, "/admin/collections/media/create", "ux-06-media-create")
  await goShot(p2, "/admin/collections/contents/580", "ux-07-doc-untitled-tenant")
  await c2.close()

  // 4) 移动端：dashboard + 列表
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const p3 = await c3.newPage()
  await login(p3, EDITOR)
  await shot(p3, "ux-08-mobile-dashboard")
  await goShot(p3, "/admin/collections/contents", "ux-09-mobile-list")
  await c3.close()

  await browser.close()
  console.log("done")
}

run().catch((e) => { console.error(e); process.exit(1) })

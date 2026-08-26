#!/usr/bin/env node
// 验证自定义 Header（面包屑/操作按钮/无重复头像）在真实列表页与文档页的渲染。
import { mkdir, readFile, stat } from "node:fs/promises"
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const OUT = new URL("./artifacts/", import.meta.url).pathname

const readOwnerOnly = async (variable) => {
  const path = process.env[variable]
  if (typeof path !== "string" || path.length === 0) throw new Error(`${variable}_REQUIRED`)
  const metadata = await stat(path)
  if (metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${variable}_INSECURE`)
  }
  const value = (await readFile(path, "utf8")).trim()
  if (value.length === 0) throw new Error(`${variable}_EMPTY`)
  return value
}

const SUPER = {
  email: process.env.ADMIN_UI_SUPER_ADMIN_EMAIL ?? "embed-boot@geo-foundry.test",
  password: await readOwnerOnly("ADMIN_UI_SUPER_ADMIN_PASSWORD_FILE"),
}

const login = async (page) => {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator('input[name="email"]').first().waitFor({ state: "visible", timeout: 90_000 })
  await page.locator('input[name="email"]').fill(SUPER.email)
  await page.locator('input[name="password"]').fill(SUPER.password)
  await page.getByRole("button", { name: /login|登录/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: 90_000 })
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 700 } })
  const page = await ctx.newPage()
  await login(page)

  await page.goto(`${BASE}/admin/collections/contents`, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${OUT}header-verify-list.png`, fullPage: false, clip: { x: 0, y: 0, width: 1600, height: 120 } })
  console.log("saved header-verify-list.png")

  // First doc in the list, if any.
  const firstLink = page.locator(".cell-id a, .row-1 a").first()
  if (await firstLink.count() > 0) {
    await firstLink.click()
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: `${OUT}header-verify-doc.png`, fullPage: false, clip: { x: 0, y: 0, width: 1600, height: 120 } })
    console.log("saved header-verify-doc.png")
  } else {
    console.log("no doc rows found, skipping doc screenshot")
  }

  await browser.close()
  console.log("done")
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

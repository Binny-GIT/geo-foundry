#!/usr/bin/env node
// 一次性截图脚本：验证新版 Tailwind/shadcn 侧边栏在 mk-dev 线上的真实渲染
// （桌面 1440px + 移动 390px）。复用 capture-overview.mjs 的登录模式。
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
  await page.locator('input[name="email"], input[type="email"]').first().waitFor({ state: "visible", timeout: 90_000 })
  await page.locator('input[name="email"], input[type="email"]').first().fill(SUPER.email)
  await page.locator('input[name="password"], input[type="password"]').first().fill(SUPER.password)
  await page.getByRole("button", { name: /login|登录/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: 90_000 })
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: 90_000 })
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()

  // Desktop: Payload's grid only defaults the sidebar open at >=1441px
  // (<=1440px is the collapsible-drawer breakpoint); use 1600px so the
  // sidebar renders open without needing a hamburger click first.
  const desktopCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const desktopPage = await desktopCtx.newPage()
  await login(desktopPage)
  await desktopPage.waitForTimeout(1_000)
  await desktopPage.screenshot({ path: `${OUT}sidebar-verify-desktop.png`, fullPage: false })
  console.log("saved sidebar-verify-desktop.png")
  await desktopPage.screenshot({ path: `${OUT}sidebar-verify-desktop-full.png`, fullPage: true })
  console.log("saved sidebar-verify-desktop-full.png")
  await desktopCtx.close()

  // Mobile: sidebar should start closed, hamburger should open it as an overlay.
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobilePage = await mobileCtx.newPage()
  await login(mobilePage)
  await mobilePage.waitForTimeout(1_000)
  await mobilePage.screenshot({ path: `${OUT}sidebar-verify-mobile-closed.png`, fullPage: false })
  console.log("saved sidebar-verify-mobile-closed.png")
  // Playwright's actionability check reports this button as outside the
  // viewport even though it's visually present in the fixed header —
  // dispatch a real click event directly instead of trying to satisfy the
  // pointer-interaction preconditions.
  await mobilePage.evaluate(() => {
    document.querySelector("button.template-default__nav-toggler")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    )
  })
  await mobilePage.waitForTimeout(800)
  await mobilePage.screenshot({ path: `${OUT}sidebar-verify-mobile-open.png`, fullPage: false })
  console.log("saved sidebar-verify-mobile-open.png")
  await mobileCtx.close()

  await browser.close()
  console.log("done")
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

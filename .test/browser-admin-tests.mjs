#!/usr/bin/env node
// geo-foundry-mk-dev 管理端 + 公开页 深度浏览器测试（真实 Chromium）
//
// 覆盖 .test/requirements/13-cms-public-endpoints.md（API-P0-050~063、API-P2-031）、
// 11-cms-access-rbac.md（UI 级越权/隔离冒烟）、10-cms-collections.md（UI 级创建冒烟）。
// 结果 JSON 写入 admin-latest-run.json，截图写入 artifacts/。
//
// 凭据：mk-dev 环境由 apps/cms/test/integration/helpers/embeddings-world.ts 种子创建的
// 固定测试账号（测试域 @geo-foundry.test，非生产资产）。见 .test/accounts.md 说明。
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com"
const ARTIFACTS = new URL("./artifacts/", import.meta.url).pathname
const TIMEOUT_MS = 60_000
const PAGE_TIMEOUT_MS = 90_000
const ATTEMPTS = 3

const ACCOUNTS = {
  superAdmin: { email: "embed-boot@geo-foundry.test", password: "bootstrap-password-260818" },
  editor: { email: "embed-editor@geo-foundry.test", password: "pw-1-editor" },
  tenantAdmin: { email: "embed-tenant-admin@geo-foundry.test", password: "pw-1-tenant" },
  foreignAdmin: { email: "embed-foreign-admin@geo-foundry.test", password: "pw-1-foreign" },
}

// 已知无害 console error（不判失败，但计入 detail）：
// favicon 缺失、第三方 Gravatar 头像（网络环境不可达；修复后应为 0，见 admin.avatar=default）
const HARMLESS = [/favicon/i, /gravatar\.com/i]

// 服务自有集合：全角色 read=false，Payload renderListView 对 read 拒绝直接 404（by design）
const BY_DESIGN_404_SLUGS = ["outbox-events", "idempotency-records"]
const VISIBLE_SLUGS = [
  "users",
  "tenants",
  "sites",
  "domains",
  "contents",
  "content-editions",
  "media",
  "url-records",
  "quality-assessments",
  "releases",
  "rollback-intents",
  "operations",
]

/**
 * 等待列表页渲染：
 * - 有数据 → SSR 直接输出 <table>（实测 <1s）
 * - 无数据 → 无表格，空态文案 "No Results."
 */
const waitForListRender = async (page) => {
  const deadline = Date.now() + PAGE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (
      await page
        .locator("table")
        .first()
        .isVisible()
        .catch(() => false)
    )
      return
    if (
      await page
        .getByText("No Results.")
        .first()
        .isVisible()
        .catch(() => false)
    )
      return
    await page.waitForTimeout(1_000)
  }
  throw new Error("list render timeout: no table and no 'No Results.'")
}

// 各集合预期行数（super-admin 全量视图，2026-08-22 生产库快照）
const EXPECTED_ROWS = {
  "content-editions": 6,
  contents: 6,
  domains: 0,
  "quality-assessments": 0,
  releases: 0,
  "rollback-intents": 0,
  sites: 3,
  "url-records": 0,
  media: 0,
  operations: 0,
  tenants: 2,
  users: 7,
}

const results = []
const record = (id, name, pass, detail) => {
  results.push({ detail, id, name, pass })
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name} :: ${String(detail).slice(0, 160)}`)
}

const withRetry = async (name, action) => {
  let lastError = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await action(attempt)
    } catch (error) {
      lastError = error
      console.log(`  retry ${attempt}/${ATTEMPTS} ${name}: ${String(error).slice(0, 100)}`)
    }
  }
  throw lastError
}

const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP geo-foundry-mk-dev.aixllent.com 104.21.53.215"],
})

/** 每个页面独立的 console/pageerror 收集器 */
const attachConsoleTracker = (page) => {
  const state = { consoleErrors: [], pageErrors: [] }
  page.on("console", (msg) => {
    if (msg.type() === "error") state.consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => state.pageErrors.push(String(err)))
  const flush = () => {
    const hard = [
      ...state.pageErrors,
      ...state.consoleErrors.filter((t) => !HARMLESS.some((re) => re.test(t))),
    ]
    const soft = state.consoleErrors.filter((t) => HARMLESS.some((re) => re.test(t)))
    state.consoleErrors = []
    state.pageErrors = []
    return { hard, soft }
  }
  return { flush }
}

const loginAs = async (context, account) => {
  const page = await context.newPage()
  const tracker = attachConsoleTracker(page)
  await page.goto(`${BASE}/admin/login`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
  await page
    .locator('input[name="email"], input[type="email"]')
    .first()
    .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
  await page.locator('input[name="email"], input[type="email"]').first().fill(account.email)
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(account.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(`${BASE}/admin*`, { timeout: PAGE_TIMEOUT_MS })
  // 等待管理端会话与客户端 Shell 完成挂载；不要把品牌标题作为就绪信号。
  await page
    .getByRole("link", { name: /^Contents$/ })
    .first()
    .waitFor({
      state: "visible",
      timeout: PAGE_TIMEOUT_MS,
    })
  await page.waitForFunction(() => document.title.trim().length > 0, { timeout: PAGE_TIMEOUT_MS })
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
  const { hard, soft } = tracker.flush()
  return { page, tracker, hard, soft }
}

try {
  await mkdir(ARTIFACTS, { recursive: true })

  // ============ Phase A: 未认证公开页 ============
  const anon = await browser.newContext({ viewport: { height: 900, width: 1440 } })

  // A1 API-P0-060 首页
  {
    const page = await anon.newPage()
    const r = await withRetry("A1", async () => {
      const response = await page.goto(`${BASE}/`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      if (response?.status() !== 200) throw new Error(`status ${response?.status()}`)
      const title = await page.title()
      if (title !== "Geo Foundry") throw new Error(`title ${title}`)
      await page
        .getByRole("heading", { name: "Content operations workspace" })
        .waitFor({ state: "visible", timeout: TIMEOUT_MS })
      return title
    })
    record("API-P0-060", "GET / 首页渲染", true, `title=${r}`)
    await page.screenshot({ path: `${ARTIFACTS}a1-homepage.png` })
    await page.close()
  }

  // A2 API-P1-061 首页管理端链接
  {
    const page = await anon.newPage()
    await withRetry("A2", async () => {
      await page.goto(`${BASE}/`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
      const links = page.locator('a:has-text("Open administration")')
      const count = await links.count()
      if (count < 1) throw new Error("No Open administration link found")
      for (let index = 0; index < count; index += 1) {
        await links.nth(index).waitFor({ state: "visible", timeout: TIMEOUT_MS })
        const href = await links.nth(index).getAttribute("href")
        if (href !== "/admin") throw new Error(`link[${index}].href=${href}`)
      }
    })
    record("API-P1-061", "首页 Open administration 指向 /admin", true, "href=/admin")
    await page.close()
  }

  // A3 API-P1-062 未知路径 404
  {
    const page = await anon.newPage()
    const status = await withRetry("A3", async () => {
      const response = await page.goto(`${BASE}/definitely-not-a-page`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      if (response?.status() !== 404) throw new Error(`status ${response?.status()}`)
      return response.status()
    })
    record("API-P1-062", "未知路径 404", true, `status=${status}`)
    await page.close()
  }

  // A4 API-P2-063 响应式 4 视口
  {
    const viewports = [
      { height: 900, width: 1440, name: "desktop" },
      { height: 768, width: 1024, name: "small-desktop" },
      { height: 1024, width: 768, name: "tablet" },
      { height: 667, width: 375, name: "mobile" },
    ]
    const details = []
    let allOk = true
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { height: vp.height, width: vp.width } })
      const page = await ctx.newPage()
      try {
        await page.goto(`${BASE}/`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
        await page
          .getByRole("heading", { name: "Content operations workspace" })
          .waitFor({ state: "visible", timeout: TIMEOUT_MS })
        const layout = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - window.innerWidth
          const primaryAction = Array.from(document.querySelectorAll("a")).find((link) =>
            link.textContent?.includes("Open administration"),
          )
          const workflow = document.querySelector('ol[aria-label="Content workflow"]')
          const workflowItems =
            workflow === null ? [] : Array.from(workflow.querySelectorAll(":scope > li"))
          const actionRect = primaryAction?.getBoundingClientRect()
          const itemRects = workflowItems.map((item) => item.getBoundingClientRect())
          const verticalWorkflow =
            window.innerWidth > 560 ||
            itemRects.every(
              (rect, index) => index === 0 || rect.top > (itemRects[index - 1]?.top ?? 0),
            )
          return {
            actionHeight: actionRect?.height ?? 0,
            actionWidth: actionRect?.width ?? 0,
            overflow,
            verticalWorkflow,
            workflowCount: workflowItems.length,
          }
        })
        const actionOk = layout.actionHeight >= 44 && layout.actionWidth >= 120
        const workflowOk = layout.workflowCount === 4 && layout.verticalWorkflow
        const viewportOk = layout.overflow <= 1 && actionOk && workflowOk
        if (!viewportOk) allOk = false
        details.push(
          `${vp.name}:${viewportOk ? "ok" : "DEFECT"}(overflow=${layout.overflow},cta=${Math.round(layout.actionWidth)}x${Math.round(layout.actionHeight)},workflow=${layout.workflowCount}/${layout.verticalWorkflow})`,
        )
        if (vp.name === "mobile")
          await page.screenshot({ path: `${ARTIFACTS}a4-mobile.png`, fullPage: true })
      } catch (error) {
        allOk = false
        details.push(`${vp.name}:ERROR=${String(error).slice(0, 60)}`)
      } finally {
        await ctx.close()
      }
    }
    record("API-P2-063", "首页响应式 4 视口", allOk, details.join(" "))
  }

  // A5 API-P0-051 登录页表单 + 无 console error
  {
    const page = await anon.newPage()
    const tracker = attachConsoleTracker(page)
    let ok = true
    let detail = ""
    try {
      await withRetry("A5", async () => {
        await page.goto(`${BASE}/admin/login`, {
          timeout: TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        })
        const email = page.locator('input[name="email"], input[type="email"]').first()
        const password = page.locator('input[name="password"], input[type="password"]').first()
        await email.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
        await password.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
        await page
          .getByRole("link", { name: /forgot password/i })
          .first()
          .waitFor({ state: "visible", timeout: TIMEOUT_MS })
        await page
          .getByRole("button", { name: /login/i })
          .first()
          .waitFor({ state: "visible", timeout: TIMEOUT_MS })
        const title = await page.title()
        const text = await page.evaluate(() => document.body.innerText)
        if (
          title !== "Login | Geo Foundry" ||
          !text.includes("Geo Foundry") ||
          !text.includes("内容运营中心")
        ) {
          throw new Error(
            `brand title=${title}; Geo Foundry intro=${text.includes("内容运营中心")}`,
          )
        }
      })
      detail = "Geo Foundry 品牌 + Email/Password/Forgot/Login 可见"
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 120)
    }
    const { hard } = tracker.flush()
    if (hard.length > 0) {
      ok = false
      detail += `; console-errors=${JSON.stringify(hard.slice(0, 3))}`
    }
    record("API-P0-051", "/admin/login 表单渲染 + 无 console error", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}a5-login.png` })
    await page.close()
  }

  // A6 API-P2-031 health 端点无鉴权（浏览器内 fetch）
  {
    const page = await anon.newPage()
    await page.goto(`${BASE}/`, { timeout: TIMEOUT_MS, waitUntil: "domcontentloaded" })
    const body = await withRetry("A6", async () => {
      const text = await page.evaluate(async () => {
        const response = await fetch("/api/health")
        return `${response.status} ${await response.text()}`
      })
      if (!text.startsWith("200 ") || !text.includes('"status":"alive"'))
        throw new Error(text.slice(0, 100))
      return text
    })
    record("API-P2-031", "GET /api/health 无鉴权可达", true, body.slice(0, 120))
    await page.close()
  }

  await anon.close()

  // ============ Phase B: super-admin 登录后管理端 ============
  const admin = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const {
    page: adminPage,
    tracker: adminTracker,
    hard: loginHard,
  } = await loginAs(admin, ACCOUNTS.superAdmin)

  // B1 API-P0-052 登录成功进入 Dashboard，侧栏集合列表
  // 期望 12 个集合在侧栏；outbox-events/idempotency-records 服务自有、read 全拒，by design 不在侧栏
  {
    const title = await adminPage.title()
    const sidebarLinks = adminPage.locator('nav a[href*="/admin/collections/"]')
    const count = await sidebarLinks.count()
    const linkHrefs = []
    for (let i = 0; i < count; i += 1)
      linkHrefs.push(await sidebarLinks.nth(i).getAttribute("href"))
    const hiddenOk = BY_DESIGN_404_SLUGS.every(
      (slug) => !linkHrefs.some((href) => href?.includes(slug)),
    )
    const dashboardState = await adminPage.evaluate(() => {
      const text = document.body.innerText
      return {
        hasAttention: text.includes("待处理事项"),
        hasDashboard: text.includes("运营控制台"),
        hasFleet: text.includes("站点概览"),
        hasPipeline: text.includes("工作流管线"),
        hasStockCollectionsHeading: Array.from(document.querySelectorAll("h1, h2")).some(
          (heading) => heading.textContent?.trim() === "Collections",
        ),
      }
    })
    const dashboardOk =
      dashboardState.hasDashboard &&
      dashboardState.hasAttention &&
      dashboardState.hasPipeline &&
      dashboardState.hasFleet &&
      !dashboardState.hasStockCollectionsHeading
    const ok =
      title === "Dashboard | Geo Foundry" &&
      count === VISIBLE_SLUGS.length &&
      hiddenOk &&
      dashboardOk &&
      loginHard.length === 0
    record(
      "API-P0-052",
      "登录成功 → Dashboard + 侧栏 12 集合 + Operations dashboard",
      ok,
      `title=${title}; sidebar-collections=${count}; service-owned-hidden=${hiddenOk}; dashboard=${dashboardOk}; stock-collections-heading=${dashboardState.hasStockCollectionsHeading}${loginHard.length ? `; login-console-errors=${JSON.stringify(loginHard.slice(0, 3))}` : ""}`,
    )
    await adminPage.screenshot({ path: `${ARTIFACTS}b1-dashboard.png` })
  }

  // B2 API-P0-050 Dashboard 客户端挂载（无 import map 缺失信号）
  {
    const { hard, soft } = adminTracker.flush()
    const bodyText = await adminPage.evaluate(() => document.body.innerText.length)
    const ok = hard.length === 0 && bodyText > 200
    record(
      "API-P0-050",
      "Dashboard 客户端挂载",
      ok,
      `body-text=${bodyText}; hard-errors=${hard.length}${soft.length ? `; soft=${soft.length}` : ""}${hard.length ? ` :: ${JSON.stringify(hard.slice(0, 3))}` : ""}`,
    )
  }

  // B3 API-P1-053 各集合列表页可打开（12 个可见集合）
  {
    const details = []
    let allOk = true
    for (const slug of VISIBLE_SLUGS) {
      const page = await admin.newPage()
      const tracker = attachConsoleTracker(page)
      try {
        await withRetry(`B3-${slug}`, async () => {
          const response = await page.goto(`${BASE}/admin/collections/${slug}`, {
            timeout: TIMEOUT_MS,
            waitUntil: "domcontentloaded",
          })
          if (response?.status() !== 200) throw new Error(`status ${response?.status()}`)
          await waitForListRender(page)
          await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
        })
        const rows = await page.locator("table tbody tr").count()
        const bodyLen = await page.evaluate(() => document.body.innerText.length)
        const { hard } = tracker.flush()
        const expected = EXPECTED_ROWS[slug] ?? -1
        const rowsOk = expected < 0 ? true : rows === expected
        const ok = bodyLen > 50 && hard.length === 0 && rowsOk
        if (!ok) allOk = false
        details.push(
          `${slug}:${ok ? "ok" : "DEFECT"}(rows=${rows}/期望${expected},err=${hard.length})${hard.length ? ` :: ${hard[0].slice(0, 80)}` : ""}`,
        )
        await page.screenshot({ path: `${ARTIFACTS}b3-${slug}.png` })
      } catch (error) {
        allOk = false
        details.push(`${slug}:ERROR=${String(error).slice(0, 80)}`)
      } finally {
        await page.close()
      }
    }
    record("API-P1-053", "12 个集合列表页可打开无空白无 console error", allOk, details.join(" | "))
  }

  // B3a Sites workspace：运营卡片应在保留的标准表格之前，且真实空态不能被伪造为已配置/已发布。
  {
    const page = await admin.newPage()
    let ok = true
    let detail = ""
    try {
      await page.goto(`${BASE}/admin/collections/sites?depth=1&limit=10`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await waitForListRender(page)
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      const state = await page.evaluate(() => {
        const workspace = document.querySelector('[aria-label="Sites workspace"]')
        const table = document.querySelector("table")
        const workspaceRect = workspace?.getBoundingClientRect()
        const tableRect = table?.getBoundingClientRect()
        const text = workspace?.textContent ?? ""
        return {
          beforeTable: (workspaceRect?.top ?? Infinity) < (tableRect?.top ?? -Infinity),
          hasDomainEmptyState: text.includes("尚未配置域名"),
          hasReleaseEmptyState: text.includes("暂无"),
          hasTitle: text.includes("站点工作区"),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        }
      })
      ok =
        state.hasTitle &&
        state.beforeTable &&
        state.hasDomainEmptyState &&
        state.hasReleaseEmptyState &&
        state.overflow <= 1
      detail = `title=${state.hasTitle}; before-table=${state.beforeTable}; domain-empty=${state.hasDomainEmptyState}; release-empty=${state.hasReleaseEmptyState}; overflow=${state.overflow}`
      await page.screenshot({ path: `${ARTIFACTS}b3a-sites-workspace.png`, fullPage: true })
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 180)
    } finally {
      await page.close()
    }
    record("COL-UI-SITES-WORKSPACE", "Sites workspace 显示真实运营空态且保留标准表格", ok, detail)
  }

  // B3b 服务自有集合 by design 404（read 全拒 → Payload not-found）
  {
    const details = []
    let allOk = true
    for (const slug of BY_DESIGN_404_SLUGS) {
      const page = await admin.newPage()
      try {
        const response = await page.goto(`${BASE}/admin/collections/${slug}`, {
          timeout: TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        })
        const ok = response?.status() === 404
        if (!ok) allOk = false
        details.push(`${slug}:${ok ? "404-ok" : `DEFECT-status=${response?.status()}`}`)
      } catch (error) {
        allOk = false
        details.push(`${slug}:ERROR=${String(error).slice(0, 80)}`)
      } finally {
        await page.close()
      }
    }
    record("COL-UI-DENIED", "服务自有集合管理页 by design 404", allOk, details.join(" | "))
  }

  // B4 API-P2-054 Media 创建表单含上传控件（S3 handler 挂载）
  // 注意：super-admin 对 media create=false（policy by design），须以 editor 身份验证
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.editor)
    const tracker = attachConsoleTracker(page)
    let ok = true
    let detail = ""
    try {
      await page.goto(`${BASE}/admin/collections/media`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await waitForListRender(page)
      // Payload 的 "Create New" 是 <a> 链接（role=link），点击后跳转独立创建页
      const createLink = page.getByRole("link", { name: /create new/i }).first()
      await createLink.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
      await createLink.click()
      await page
        .goto(`${BASE}/admin/collections/media/create`, {
          timeout: TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        })
        .catch(() => {})
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      // S3 客户端上传 handler 挂载 = file input 存在（原生 input 被拖拽区样式隐藏属正常）
      const fileInput = page.locator('input[type="file"]').first()
      const inputExists = (await fileInput.count()) > 0
      const dropZoneVisible = await page
        .getByText(/select a file/i)
        .first()
        .isVisible()
        .catch(() => false)
      const modalText = (await page.evaluate(() => document.body.innerText)).slice(0, 400)
      detail = `file-input-exists=${inputExists}; dropzone-visible=${dropZoneVisible}; form=${modalText.slice(0, 120).replace(/\s+/g, " ")}`
      ok = inputExists && dropZoneVisible
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    const { hard } = tracker.flush()
    if (hard.length) {
      ok = false
      detail += `; console-errors=${JSON.stringify(hard.slice(0, 2))}`
    }
    record("API-P2-054", "editor: Media 创建表单上传控件可见", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}b4-media-create.png` })
    await ctx.close()
  }

  // B5 文档视图冒烟：打开第一篇 contents 文档
  {
    const page = await admin.newPage()
    const tracker = attachConsoleTracker(page)
    let ok = true
    let detail = ""
    try {
      await page.goto(`${BASE}/admin/collections/contents`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await page.waitForSelector("table tbody tr", { timeout: PAGE_TIMEOUT_MS })
      const firstRow = page.locator("table tbody tr").first()
      const rowLink = firstRow.locator("a").first()
      await rowLink.click()
      await page.waitForURL(/\/admin\/collections\/contents\/.+/, { timeout: PAGE_TIMEOUT_MS })
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      await page.waitForTimeout(3000)
      const bodyLen = await page.evaluate(() => document.body.innerText.length)
      detail = `url=${page.url().replace(BASE, "")}; body-text=${bodyLen}`
      ok = bodyLen > 100
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    const { hard } = tracker.flush()
    if (hard.length) {
      ok = false
      detail += `; console-errors=${JSON.stringify(hard.slice(0, 3))}`
    }
    record("COL-UI-DOC", "contents 文档视图渲染", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}b5-content-doc.png`, fullPage: true })
    await page.close()
  }

  await admin.close()

  // ============ Phase C: RBAC 冒烟（UI 级） ============
  // C1 editor 访问 users 列表 → 仅可见自己 1 行（self-scope；/api/users/me 依赖此能力）
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.editor)
    let ok = true
    let detail = ""
    try {
      const response = await page.goto(`${BASE}/admin/collections/users`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      if (response?.status() !== 200) throw new Error(`status ${response?.status()}`)
      await waitForListRender(page)
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      const rows = await page.locator("table tbody tr").count()
      const pageText = await page.evaluate(() => document.body.innerText)
      const selfOnly =
        rows === 1 && pageText.includes(ACCOUNTS.editor.email) && !pageText.includes("embed-boot@")
      detail = `status=200; rows=${rows} (期望 1=仅自己); self-row=${selfOnly}`
      ok = selfOnly
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    record("RBAC-UI-001", "editor 访问 users 列表仅见自己 1 行（self-scope）", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}c1-editor-users.png` })
    await ctx.close()
  }

  // C1b editor 的租户绑定由服务端强制，表单不应显示无法选择的 Tenant 字段；列表不应显示 Untitled-ID 噪音
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.editor)
    let ok = true
    let detail = ""
    try {
      await page.goto(`${BASE}/admin/collections/contents/create`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      const createText = await page.evaluate(() => document.body.innerText)
      const tenantInputCount = await page
        .locator('label:text-is("Tenant"), [name="tenant"]')
        .count()
      await page.goto(`${BASE}/admin/collections/contents`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await waitForListRender(page)
      const listText = await page.evaluate(() => document.body.innerText)
      const hidden = tenantInputCount === 0 && !createText.includes("Tenant\n*")
      const cleanCell = listText.includes("Current tenant") && !listText.includes("Untitled - ID")
      ok = hidden && cleanCell
      detail = `tenant-control-hidden=${hidden}; tenant-cell-clean=${cleanCell}`
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    record("RBAC-UI-004", "editor 租户字段隐藏且列表无 Untitled-ID", ok, detail)
    await ctx.close()
  }

  // C1c 登录用户访问无 create 权限页面时，提示应说明权限而非要求再次登录
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.superAdmin)
    let ok = true
    let detail = ""
    try {
      await page.goto(`${BASE}/admin/collections/sites/create`, {
        timeout: TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      const text = await page.evaluate(() => document.body.innerText)
      ok = text.includes("You do not have permission") && !text.includes("must be logged in")
      detail = `permission-copy=${ok}`
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    record("RBAC-UI-005", "无 create 权限页显示准确权限提示", ok, detail)
    await ctx.close()
  }

  // C2 tenant-admin 访问 sites → 仅本租户 2 个站点，不可见 foreign 站点
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.tenantAdmin)
    let ok = true
    let detail = ""
    try {
      await withRetry("C2", async () => {
        const response = await page.goto(`${BASE}/admin/collections/sites`, {
          timeout: TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        })
        if (response?.status() !== 200) throw new Error(`status ${response?.status()}`)
        await waitForListRender(page)
        await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      })
      const rows = await page.locator("table tbody tr").count()
      const pageText = await page.evaluate(() => document.body.innerText)
      detail = `rows=${rows} (期望 2)${rows !== 2 ? `; page=${pageText.replace(/\s+/g, " ").slice(0, 150)}` : "; 含 Embed Site A/B"}`
      ok = rows === 2 && !pageText.includes("Embed Foreign")
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    record("RBAC-UI-002", "tenant-admin sites 列表租户隔离（仅本租户 2 站点）", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}c2-tenantadmin-sites.png` })
    await ctx.close()
  }

  // C3 反向隔离：foreign-admin 仅见 1 个 foreign 站点
  {
    const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page } = await loginAs(ctx, ACCOUNTS.foreignAdmin)
    let ok = true
    let detail = ""
    try {
      await withRetry("C3", async () => {
        const response = await page.goto(`${BASE}/admin/collections/sites`, {
          timeout: TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        })
        if (response?.status() !== 200) throw new Error(`status ${response?.status()}`)
        await waitForListRender(page)
        await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => {})
      })
      const rows = await page.locator("table tbody tr").count()
      const pageText = await page.evaluate(() => document.body.innerText)
      detail = `rows=${rows} (期望 1)${rows !== 1 ? `; page=${pageText.replace(/\s+/g, " ").slice(0, 150)}` : "; 含 Embed Foreign"}`
      ok = rows === 1 && pageText.includes("Embed Foreign") && !pageText.includes("Embed Site A")
    } catch (error) {
      ok = false
      detail = String(error).slice(0, 150)
    }
    record("RBAC-UI-003", "foreign-admin sites 反向隔离（仅 1 foreign 站点）", ok, detail)
    await page.screenshot({ path: `${ARTIFACTS}c3-foreignadmin-sites.png` })
    await ctx.close()
  }
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
  new URL("./admin-latest-run.json", import.meta.url).pathname,
  `${JSON.stringify(summary, null, 2)}\n`,
)
process.exitCode = failed.length === 0 ? 0 : 1

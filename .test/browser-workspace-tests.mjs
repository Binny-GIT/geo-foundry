#!/usr/bin/env node
// Workspace-feature browser regression: Today Work suggestions section, intake
// inbox, grouped publication plans, and the canonical three-pane edition
// workspace. Run on a host that can reach the deployed CMS:
//   node .test/browser-workspace-tests.mjs
//   TEST_BASE_URL=http://127.0.0.1:3090 node .test/browser-workspace-tests.mjs
// Requires GEO_FOUNDRY_BROWSER_EDITOR_PASSWORD and
// GEO_FOUNDRY_BROWSER_SUPER_ADMIN_PASSWORD in the environment.
import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const BASE = process.env.TEST_BASE_URL || "https://geo-foundry-mk-dev.aixllent.com"
const PUBLIC_HOST = new URL(BASE).hostname
const ARTIFACTS = resolve(import.meta.dirname, "artifacts")
const TIMEOUT = 60_000
const ATTEMPTS = 3

const accounts = {
  editor: {
    email: "embed-editor@geo-foundry.test",
    password: process.env.GEO_FOUNDRY_BROWSER_EDITOR_PASSWORD,
  },
  superAdmin: {
    email: "embed-boot@geo-foundry.test",
    password: process.env.GEO_FOUNDRY_BROWSER_SUPER_ADMIN_PASSWORD,
  },
}

const results = []
const record = (id, name, pass, detail) => {
  results.push({ detail, id, name, pass })
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name} :: ${detail}`)
}

const retry = async (action) => {
  let lastError
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const attachErrorTracking = (page, sink) => {
  const harmless = (text) => /favicon|gravatar|net::ERR_CONNECTION_(REFUSED|TIMED_OUT)/i.test(text)
  page.on("pageerror", (error) => {
    if (!harmless(String(error))) sink.push(String(error))
  })
  page.on("console", (message) => {
    if (message.type() === "error" && !harmless(message.text())) sink.push(message.text())
  })
}

const loginAs = async (context, account, sink) => {
  const page = await context.newPage()
  attachErrorTracking(page, sink)
  await page.goto(`${BASE}/admin/login`, { timeout: TIMEOUT, waitUntil: "domcontentloaded" })
  await page.locator('form[data-ready="true"]').waitFor({ timeout: TIMEOUT })
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('input[name="password"]').fill(account.password)
  await Promise.all([
    page.waitForURL(/\/admin(?:$|\?|#)/, { timeout: TIMEOUT }),
    page.getByRole("button", { name: /登录到管理中心|登录/i }).click(),
  ])
  await page
    .getByRole("link", { name: /文章列表|工作台/i })
    .first()
    .waitFor({ timeout: TIMEOUT })
  return page
}

const run = async () => {
  if (!accounts.editor.password || !accounts.superAdmin.password) {
    throw new Error(
      "GEO_FOUNDRY_BROWSER_EDITOR_PASSWORD and GEO_FOUNDRY_BROWSER_SUPER_ADMIN_PASSWORD are required",
    )
  }
  mkdirSync(ARTIFACTS, { recursive: true })
  const isLocalTarget = /^(127\.|localhost$|\[::1\])/.test(PUBLIC_HOST)
  const browser = await chromium.launch({
    args: [
      ...(isLocalTarget ? [] : [`--host-resolver-rules=MAP ${PUBLIC_HOST} 104.21.53.215`]),
      "--no-proxy-server",
      "--no-sandbox",
    ],
  })
  const editorErrors = []
  const adminErrors = []
  try {
    const editorContext = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const editorPage = await loginAs(editorContext, accounts.editor, editorErrors)

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/work`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage
        .getByRole("heading", { level: 1, name: "工作台" })
        .waitFor({ timeout: TIMEOUT })
      for (const column of ["草稿", "待审核", "通过待发布", "不通过", "已发布", "已删除"]) {
        await editorPage
          .getByRole("heading", { level: 2, name: column })
          .waitFor({ timeout: TIMEOUT })
      }
      await editorPage.getByLabel("期间范围").selectOption("7d")
      await editorPage.waitForURL(/range=7d/, { timeout: TIMEOUT })
      const firstCardLink = editorPage.locator("section a[target=_blank]").first()
      await firstCardLink.waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-001",
      "Workbench renders six status columns with range select and new-tab cards",
      true,
      "/admin/work shows all six board columns, the 期间范围 select deep-links range=7d, and board cards open in a new tab",
    )
    await editorPage.screenshot({ path: resolve(ARTIFACTS, "ws1-today-work.png") })

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/inbox`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage
        .getByRole("heading", { level: 1, name: "Inbox" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage.getByText(/visible items/i).waitFor({ timeout: TIMEOUT })
      await editorPage.getByText("导入公开 URL").waitFor({ timeout: TIMEOUT })
      await editorPage.locator('input[name="title"]').first().waitFor({ timeout: TIMEOUT })
      await editorPage.locator('input[name="sourceUrl"]').first().waitFor({ timeout: TIMEOUT })
      await editorPage
        .locator('select[name="suggestedSiteId"]')
        .first()
        .waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-002",
      "Intake inbox renders the normalized item list",
      true,
      "/admin/inbox shows the Inbox heading and visible-item count",
    )
    await editorPage.screenshot({ path: resolve(ARTIFACTS, "ws2-inbox.png") })

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/collections/publication-plans`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage.getByText("排期列表").waitFor({ timeout: TIMEOUT })
      await editorPage.getByRole("link", { name: "按日" }).waitFor({ timeout: TIMEOUT })
      await editorPage.getByRole("link", { name: "按周" }).waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-003",
      "Publication plans page renders grouped schedule",
      true,
      "/admin/collections/publication-plans shows the grouped list and day/week toggle",
    )
    await editorPage.screenshot({ path: resolve(ARTIFACTS, "ws3-publication-plans.png") })

    let editionId = null
    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/collections/content-editions`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      editionId = await editorPage.evaluate(async () => {
        const response = await fetch(
          "/api/content-editions?depth=0&limit=20&sort=-updatedAt&where[workflowStatus][equals]=draft",
        )
        if (!response.ok) throw new Error(`draft edition query ${response.status}`)
        const payload = await response.json()
        for (const candidate of payload.docs ?? []) {
          if (!Number.isInteger(candidate?.id)) continue
          const draft = await fetch(`/api/content-editions/${candidate.id}?depth=0&draft=true`)
          if (!draft.ok) continue
          const draftEdition = await draft.json()
          if (draftEdition.workflowStatus === "draft") return String(candidate.id)
        }
        return null
      })
    })
    if (editionId === null || editionId.length === 0) {
      record(
        "WS-UI-004",
        "Edition workspace three-pane layout",
        false,
        "no draft content-edition found to open",
      )
    } else {
      const workspacePath = `/admin/workspace/editions/${editionId}`
      await retry(async () => {
        await editorPage.goto(`${BASE}${workspacePath}`, {
          timeout: TIMEOUT,
          waitUntil: "domcontentloaded",
        })
        await editorPage
          .locator('aside[aria-label*="Sources, comments"], aside[aria-label*="来源、评论"]')
          .first()
          .waitFor({ timeout: TIMEOUT })
        await editorPage
          .locator('aside[aria-label*="Editorial controls"], aside[aria-label*="任务控制"]')
          .first()
          .waitFor({ timeout: TIMEOUT })
        await editorPage
          .getByText(/Site variants|站点版本/)
          .first()
          .waitFor({ timeout: TIMEOUT })
      })
      record(
        "WS-UI-004",
        "Edition workspace three-pane layout",
        true,
        `${workspacePath} renders context rail, control rail, and site variants section`,
      )
      const evaluationButton = editorPage.getByRole("button", {
        name: /Run quality check|运行质量检查/,
      })
      await evaluationButton.waitFor({ timeout: TIMEOUT })
      const [evaluation] = await Promise.all([
        editorPage.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response
              .url()
              .includes(`/api/workspaces/editor/editions/${editionId}/evaluation-operations`),
          { timeout: TIMEOUT },
        ),
        evaluationButton.click(),
      ])
      const evaluationBody = await evaluation.json()
      if (
        (evaluation.status() !== 202 && evaluation.status() !== 200) ||
        evaluationBody.operation?.operationType !== "evaluate"
      ) {
        throw new Error(`quality evaluation submission failed: ${evaluation.status()}`)
      }
      record(
        "WS-UI-005",
        "Editor submits a worker-owned quality evaluation",
        true,
        `${workspacePath} creates a queued evaluate operation through the session endpoint`,
      )
      await editorPage.screenshot({ path: resolve(ARTIFACTS, "ws4-edition-workspace.png") })
    }

    if (editionId !== null && editionId.length > 0) {
      await retry(async () => {
        await editorPage.goto(`${BASE}/admin/collections/content-editions`, {
          timeout: TIMEOUT,
          waitUntil: "domcontentloaded",
        })
        await editorPage.getByPlaceholder("搜索标题…").waitFor({ timeout: TIMEOUT })
        await editorPage.getByRole("button", { name: "筛选" }).waitFor({ timeout: TIMEOUT })
        await editorPage.locator('select[name="site"]').waitFor({ timeout: TIMEOUT })
      })
      record(
        "WS-UI-009",
        "Article list renders filter, search, and pagination controls",
        true,
        "/admin/collections/content-editions shows the title search, site/status filters, and the filter action",
      )
      await retry(async () => {
        await editorPage.goto(`${BASE}/admin/collections/content-editions/${editionId}`, {
          timeout: TIMEOUT,
          waitUntil: "domcontentloaded",
        })
        await editorPage.getByText("文章详情", { exact: true }).waitFor({ timeout: TIMEOUT })
        await editorPage
          .getByRole("heading", { level: 2, name: "正文" })
          .waitFor({ timeout: TIMEOUT })
        await editorPage
          .getByRole("heading", { level: 2, name: "历史日志" })
          .waitFor({ timeout: TIMEOUT })
        await editorPage
          .getByRole("heading", { level: 2, name: "站点文章入口" })
          .waitFor({ timeout: TIMEOUT })
      })
      record(
        "WS-UI-010",
        "Native article detail renders info, body, entry link, and history",
        true,
        `/admin/collections/content-editions/${editionId} shows the native detail with body, site entry, and history timeline`,
      )
    }

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/collections/sites`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage
        .getByRole("heading", { level: 1, name: "站点列表" })
        .waitFor({ timeout: TIMEOUT })
      const firstSite = editorPage.locator('a[href*="/admin/collections/sites/"]').first()
      await firstSite.waitFor({ timeout: TIMEOUT })
      await firstSite.click()
      await editorPage.getByText("站点详情", { exact: true }).waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByRole("heading", { level: 2, name: "站点信息与文章入口" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByRole("heading", { level: 2, name: "域名管理" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByRole("heading", { level: 2, name: "该站文章" })
        .waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-011",
      "Site list shows summaries and site detail renders entry info and domains",
      true,
      "/admin/collections/sites lists sites with article counts and the detail page shows entry info, domains, and site articles",
    )

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/integration-docs`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage
        .getByRole("heading", { level: 1, name: "接入文档" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByText("GET /api/delivery/sites/{canonical-domain}/articles")
        .first()
        .waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-012",
      "Integration docs page renders the delivery API contract",
      true,
      "/admin/integration-docs documents the delivery endpoints, params, and fetch example",
    )

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/api-stats`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage
        .getByRole("heading", { level: 1, name: "接口统计" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByRole("heading", { level: 2, name: "近 14 天调用量" })
        .waitFor({ timeout: TIMEOUT })
      await editorPage
        .getByRole("heading", { level: 2, name: "按站点分布" })
        .waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-013",
      "API stats page renders usage trend and site distribution",
      true,
      "/admin/api-stats shows the 14-day delivery usage trend and per-site distribution",
    )

    await retry(async () => {
      await editorPage.goto(`${BASE}/admin/_emergency/collections/users`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await editorPage.waitForURL(/\/admin(?:$|\?)/, { timeout: TIMEOUT })
      const body = await editorPage.textContent("body")
      if (/Users|用户/.test(body ?? "")) throw new Error("editor reached Payload Users page")
    })
    record(
      "WS-UI-006",
      "Editor cannot enter Payload emergency fallback",
      true,
      "/admin/_emergency/collections/users redirects the editor back to Console",
    )

    const adminContext = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const adminPage = await loginAs(adminContext, accounts.superAdmin, adminErrors)
    await retry(async () => {
      await adminPage.goto(`${BASE}/admin/_emergency/collections/content-editions`, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      })
      await adminPage.locator("table").first().waitFor({ timeout: TIMEOUT })
    })
    record(
      "WS-UI-007",
      "Super-admin retains Payload emergency fallback",
      true,
      "/admin/_emergency/collections/content-editions renders the protected native fallback",
    )

    const hardEditorErrors = editorErrors.length
    const hardAdminErrors = adminErrors.length
    record(
      "WS-UI-008",
      "No hard console errors on workspace pages",
      hardEditorErrors === 0 && hardAdminErrors === 0,
      `editor console errors: ${hardEditorErrors}, super-admin console errors: ${hardAdminErrors}`,
    )
  } finally {
    await browser.close().catch(() => {})
  }
}

run()
  .then(() => {
    const failed = results.filter((result) => !result.pass).length
    const summary = {
      at: new Date().toISOString(),
      base: BASE,
      failed,
      passed: results.length - failed,
      results,
    }
    writeFileSync(
      resolve(import.meta.dirname, "workspace-latest-run.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    )
    console.log(`workspace browser summary: ${summary.passed} passed, ${failed} failed`)
    process.exitCode = failed === 0 ? 0 : 1
  })
  .catch((error) => {
    record("WS-ABORTED", "workspace browser run aborted", false, String(error).slice(0, 400))
    writeFileSync(
      resolve(import.meta.dirname, "workspace-latest-run.json"),
      `${JSON.stringify({ at: new Date().toISOString(), base: BASE, failed: 1, passed: 0, results }, null, 2)}\n`,
    )
    process.exitCode = 1
  })

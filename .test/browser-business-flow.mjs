#!/usr/bin/env node
import { chromium } from "@playwright/test"

const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3090"
const timeout = 8 * 60_000
const marker = `browser-business-${Date.now()}`

const credentials = {
  editor: {
    email: "embed-editor@geo-foundry.test",
    password: process.env.GEO_FOUNDRY_BROWSER_EDITOR_PASSWORD,
  },
  publisher: {
    email: "browser-business-publisher@geo-foundry.test",
    password: process.env.GEO_FOUNDRY_BROWSER_PUBLISHER_PASSWORD,
  },
  reviewer: {
    email: "browser-business-reviewer@geo-foundry.test",
    password: process.env.GEO_FOUNDRY_BROWSER_REVIEWER_PASSWORD,
  },
}

if (Object.values(credentials).some((account) => !account.password)) {
  throw new Error("BROWSER_BUSINESS_PASSWORDS_REQUIRED")
}

const waitFor = async (probe, label, intervalMs = 2_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== null) return result
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`BROWSER_BUSINESS_TIMEOUT:${label}`)
}

const api = async (page, path) =>
  page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" })
    return { body: await response.json(), status: response.status }
  }, path)

const login = async (browser, account) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.locator('form[data-ready="true"]').waitFor({ timeout: 30_000 })
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('input[name="password"]').fill(account.password)
  await Promise.all([
    page.waitForURL(/\/admin(?:$|\?)/, { timeout: 30_000 }),
    page.getByRole("button", { name: /登录到管理中心|登录/i }).click(),
  ])
  return { context, page }
}

const editionState = async (page, editionId) => {
  const result = await api(page, `/api/content-editions/${editionId}?depth=0&draft=true`)
  if (result.status !== 200 || typeof result.body.workflowStatus !== "string") {
    throw new Error(`BROWSER_BUSINESS_EDITION_READ_FAILED:${result.status}`)
  }
  return result.body.workflowStatus
}

const transition = async (page, editionId, label, expectedState) => {
  const button = page.getByRole("button", { name: label })
  await button.waitFor({ timeout: 60_000 })
  const [result] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes("/api/editions/") &&
        candidate.url().includes("/workflow-transitions"),
      { timeout: 60_000 },
    ),
    button.click(),
  ])
  if (!result.ok()) throw new Error(`BROWSER_BUSINESS_TRANSITION_FAILED:${label}:${result.status()}`)
  await waitFor(async () => (await editionState(page, editionId)) === expectedState ? true : null, `state-${expectedState}`)
}

const reviewerDecision = async (page, editionId, label, reason, expectedState) => {
  await page.getByRole("button", { name: label }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 30_000 })
  if (reason !== undefined) await dialog.locator("textarea").fill(reason)
  const [result] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes("/api/workspaces/reviewer/editions/"),
      { timeout: 60_000 },
    ),
    dialog.getByRole("button", { name: /确认操作|Confirm action/ }).click(),
  ])
  if (!result.ok()) throw new Error(`BROWSER_BUSINESS_REVIEW_FAILED:${label}:${result.status()}`)
  await waitFor(async () => (await editionState(page, editionId)) === expectedState ? true : null, `state-${expectedState}`)
}

const schedule = async (page, editionId, timezone) => {
  const at = new Date(Date.now() + 75_000).toISOString()
  const input = page.getByLabel(/发布时间|Publish at \(UTC\)/)
  await input.fill(at)
  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/api/publication-plan-operations"),
    { timeout: 60_000 },
  )
  await page.getByRole("button", { name: /创建发布排期|Schedule publication/ }).click()
  const result = await response
  if (!result.ok()) throw new Error(`BROWSER_BUSINESS_SCHEDULE_FAILED:${result.status()}`)
  const body = await result.json()
  return { planId: body.plan?.planId, timezone }
}

const releasePair = async (page, siteId) => {
  const releases = await waitFor(async () => {
    const result = await api(page, `/api/releases?depth=0&limit=20&where[site][equals]=${siteId}`)
    if (result.status !== 200) return null
    const current = result.body.docs?.find((release) => release.state === "current")
    const previous = result.body.docs?.find((release) => release.state === "superseded")
    return current && previous ? { current, previous } : null
  }, "release-pair")
  return releases
}

const waitPublished = async (page, editionId, planId) =>
  waitFor(async () => {
    const [edition, plans] = await Promise.all([
      api(page, `/api/content-editions/${editionId}?depth=0`),
      api(page, `/api/publication-plans?depth=0&limit=1&where[planId][equals]=${encodeURIComponent(planId)}`),
    ])
    const plan = plans.body.docs?.[0]
    if (edition.status !== 200 || plan?.status === "failed" || plan?.status === "cancelled") {
      throw new Error(`BROWSER_BUSINESS_PUBLISH_FAILED:${plan?.status ?? "unknown"}`)
    }
    return edition.body.workflowStatus === "published" && plan?.status === "succeeded" ? { edition: edition.body, plan } : null
  }, "publish")

const createRollback = async (page, siteId, current, target, reason) => {
  await page.goto(`${base}/admin/collections/rollback-intents/create`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await page.locator('input[name="siteId"]').fill(String(siteId))
  await page.locator('input[name="expectedCurrentReleaseId"]').fill(current.releaseId)
  await page.locator('input[name="expectedCurrentManifestSha256"]').fill(current.manifestSha256)
  await page.locator('input[name="targetReleaseId"]').fill(target.releaseId)
  await page.locator('input[name="expectedManifestSha256"]').fill(target.manifestSha256)
  await page.locator('textarea[name="reason"]').fill(reason)
  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/api/rollback-operations/intents"),
    { timeout: 60_000 },
  )
  const navigation = page.waitForURL(
    (url) =>
      url.pathname === "/admin/collections/rollback-intents" ||
      (url.pathname.startsWith("/admin/collections/rollback-intents/") &&
        url.pathname !== "/admin/collections/rollback-intents/create"),
    { timeout: 60_000 },
  )
  await page.getByRole("button", { name: "创建回滚意图" }).click()
  const result = await response
  if (!result.ok()) throw new Error(`BROWSER_BUSINESS_ROLLBACK_INTENT_FAILED:${result.status()}`)
  await navigation
  return waitFor(async () => {
    const intents = await api(
      page,
      `/api/rollback-intents?depth=0&limit=1&sort=-createdAt&where[reason][equals]=${encodeURIComponent(reason)}`,
    )
    const intent = intents.status === 200 ? intents.body.docs?.[0] : null
    return typeof intent?.intentId === "string" ? intent : null
  }, "rollback-intent-created")
}

const browser = await chromium.launch({ args: ["--no-proxy-server", "--no-sandbox"] })
let editorContext
let reviewerContext
let publisherContext
let businessEditionId = null
try {
  const editor = await login(browser, credentials.editor)
  editorContext = editor.context
  const editorPage = editor.page

  await editorPage.goto(`${base}/admin/inbox`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  const site = await waitFor(async () => {
    const domains = await api(editorPage, "/api/domains?depth=0&limit=20&where[role][equals]=canonical&where[status][equals]=active")
    const domain = domains.status === 200 ? domains.body.docs?.find((row) => Number.isInteger(row?.site)) : null
    if (domain === undefined || domain === null) return null
    const result = await api(editorPage, `/api/sites/${domain.site}?depth=0`)
    return result.status === 200 ? result.body : null
  }, "editor-site-with-canonical-domain")
  await editorPage.locator('input[name="title"]').fill(marker)
  await editorPage.locator('input[name="sourceUrl"]').fill(`https://example.com/?geo-foundry-run=${encodeURIComponent(marker)}`)
  await editorPage.locator('select[name="suggestedSiteId"]').selectOption(String(site.id))
  const importResponse = editorPage.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/api/intake-operations"),
    { timeout: 60_000 },
  )
  await editorPage.getByRole("button", { name: "导入 URL" }).click()
  const imported = await importResponse
  const importedBody = await imported.json()
  if (!imported.ok() || importedBody.fetchQueued !== true) throw new Error("BROWSER_BUSINESS_IMPORT_FAILED")
  const intakeId = importedBody.intakeItem.id

  const readyIntake = await waitFor(async () => {
    const result = await api(editorPage, `/api/intake-items/${intakeId}?depth=0`)
    if (result.status !== 200) return null
    if (result.body.status === "failed") throw new Error(`BROWSER_BUSINESS_FETCH_FAILED:${result.body.failureCode}`)
    return result.body.status === "ready" ? result.body : null
  }, "intake-ready")

  await editorPage.goto(`${base}/admin/inbox?status=ready`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await editorPage.locator("button").filter({ hasText: readyIntake.title }).first().click()
  const adoptResponse = editorPage.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes(`/api/intake-operations/${intakeId}/adopt`),
    { timeout: 60_000 },
  )
  await editorPage.getByRole("button", { name: "Adopt" }).click()
  const adopted = await adoptResponse
  const adoptedBody = await adopted.json()
  if (!adopted.ok() || !Number.isInteger(adoptedBody.editionId)) throw new Error("BROWSER_BUSINESS_ADOPT_FAILED")
  const editionId = adoptedBody.editionId
  businessEditionId = editionId

  await editorPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await editorPage.getByRole("button", { name: "编辑内容" }).click()
  await editorPage.locator('input[placeholder="内容标题"]').fill(`${marker} content quality review`)
  await editorPage.locator('textarea[placeholder="用一两句话说明读者将获得什么"]').fill("This editorial draft explains why a well-structured source review supports a reliable content operation.")
  await editorPage.getByRole("button", { name: "+ 段落" }).click()
  await editorPage.locator('textarea[placeholder="开始输入正文…"]').last().fill("A reliable content operation starts with a public source, keeps the source linked to the draft, and turns editorial review into an explicit, auditable decision. This fixture contains sufficient original explanatory content for the deterministic quality gate.")
  await editorPage.getByRole("button", { name: "+ 标题" }).click()
  await editorPage.locator('textarea[placeholder="标题"]').last().fill("Editorial quality review")
  const saveResponse = editorPage.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes(`/api/content-editions/${editionId}`),
    { timeout: 60_000 },
  )
  await editorPage.getByRole("button", { name: "保存草稿" }).click()
  if (!(await saveResponse).ok()) throw new Error("BROWSER_BUSINESS_SAVE_FAILED")
  const evaluationButton = editorPage.getByRole("button", { name: "运行质量检查" })
  await evaluationButton.waitFor({ timeout: 60_000 })
  const evaluationResponse = editorPage.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes(`/api/workspaces/editor/editions/${editionId}/evaluation-operations`),
    { timeout: 60_000 },
  )
  await evaluationButton.click()
  if (!(await evaluationResponse).ok()) throw new Error("BROWSER_BUSINESS_EVALUATION_SUBMIT_FAILED")
  await waitFor(async () => {
    const result = await api(editorPage, `/api/workspaces/editions/${editionId}/context`)
    return result.status === 200 && result.body.quality?.state === "passed" ? result.body : null
  }, "quality-passed")

  await transition(editorPage, editionId, "开始生成", "generating")
  await transition(editorPage, editionId, "提交审核", "review")

  const reviewer = await login(browser, credentials.reviewer)
  reviewerContext = reviewer.context
  const reviewerPage = reviewer.page
  await reviewerPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await reviewerDecision(reviewerPage, editionId, "退回修改", `${marker} needs a clearer opening`, "draft")

  await editorPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await transition(editorPage, editionId, "开始生成", "generating")
  await transition(editorPage, editionId, "提交审核", "review")

  await reviewerPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await reviewerDecision(reviewerPage, editionId, "批准版本", undefined, "approved")

  const publisher = await login(browser, credentials.publisher)
  publisherContext = publisher.context
  const publisherPage = publisher.page
  await publisherPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  const { planId } = await schedule(publisherPage, editionId, site.timezone)
  if (typeof planId !== "string") throw new Error("BROWSER_BUSINESS_PLAN_ID_MISSING")
  const published = await waitPublished(publisherPage, editionId, planId)
  if (published.edition.workflowStatus !== "published") throw new Error("BROWSER_BUSINESS_NOT_PUBLISHED")

  await editorPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await editorPage.getByRole("button", { name: "创建新草稿" }).click()
  const draftDialog = editorPage.getByRole("dialog")
  await draftDialog.getByRole("button", { name: "确认操作" }).click()
  await transition(editorPage, editionId, "开始生成", "generating")
  await transition(editorPage, editionId, "提交审核", "review")
  await reviewerPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await reviewerDecision(reviewerPage, editionId, "批准版本", undefined, "approved")
  await publisherPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  const secondPlan = await schedule(publisherPage, editionId, site.timezone)
  if (typeof secondPlan.planId !== "string") throw new Error("BROWSER_BUSINESS_SECOND_PLAN_ID_MISSING")
  await waitPublished(publisherPage, editionId, secondPlan.planId)

  const pair = await releasePair(publisherPage, site.id)
  const rollback = await createRollback(publisherPage, site.id, pair.current, pair.previous, marker)
  await waitFor(async () => {
    const intents = await api(publisherPage, `/api/rollback-intents?depth=0&limit=1&where[intentId][equals]=${rollback.intentId}`)
    const releases = await api(publisherPage, `/api/releases?depth=0&limit=20&where[site][equals]=${site.id}`)
    const current = releases.body.docs?.find((release) => release.state === "current")
    return intents.status === 200 && intents.body.docs?.[0]?.consumedAt && current?.releaseId === pair.previous.releaseId ? true : null
  }, "rollback-consumed")
  const restoration = await createRollback(publisherPage, site.id, pair.previous, pair.current, `${marker} restore`)
  await waitFor(async () => {
    const intents = await api(publisherPage, `/api/rollback-intents?depth=0&limit=1&where[intentId][equals]=${restoration.intentId}`)
    const releases = await api(publisherPage, `/api/releases?depth=0&limit=20&where[site][equals]=${site.id}`)
    const current = releases.body.docs?.find((release) => release.state === "current")
    return intents.status === 200 && intents.body.docs?.[0]?.consumedAt && current?.releaseId === pair.current.releaseId ? true : null
  }, "rollback-restored")

  await publisherPage.goto(`${base}/admin/workspace/editions/${editionId}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await publisherPage.getByRole("button", { name: "归档版本" }).click()
  const archiveDialog = publisherPage.getByRole("dialog")
  await archiveDialog.getByRole("button", { name: "确认操作" }).click()
  await waitFor(async () => {
    const edition = await api(publisherPage, `/api/content-editions/${editionId}?depth=0`)
    return edition.status === 200 && edition.body.workflowStatus === "archived" ? true : null
  }, "edition-archived")

  console.log(JSON.stringify({ code: "BROWSER_BUSINESS_FLOW_SUCCEEDED", editionId, marker, rollbackIntentId: rollback.intentId }))
} finally {
  await Promise.all([editorContext?.close(), reviewerContext?.close(), publisherContext?.close()].filter(Boolean))
  await browser.close()
}

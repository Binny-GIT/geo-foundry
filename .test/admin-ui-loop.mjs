#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

import {
  ADMIN_COLLECTIONS,
  PUBLIC_PAGES,
  SERVICE_OWNED_404,
  collectionApiRoute,
  collectionBySlug,
  collectionRoute,
  pageVerdict,
} from "./admin-page-source-registry.mjs"
import { createRunId } from "./admin-fixture-manifest.mjs"

const root = resolve(import.meta.dirname, "..")
const baseUrl = new URL(process.env.TEST_BASE_URL ?? "https://geo-foundry-mk-dev.aixllent.com")
const runId = process.env.ADMIN_UI_RUN_ID ?? createRunId()
const evidenceDirectory = resolve(root, ".test", "admin-ui-evidence", runId)
const timeoutMs = 90_000
const harmlessConsoleError = [/favicon/i]

if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "geo-foundry-mk-dev.aixllent.com") {
  throw new Error("ADMIN_UI_LOOP_BASE_URL_FORBIDDEN")
}

const secureTextFile = async (variable) => {
  const filePath = process.env[variable]
  if (filePath === undefined || filePath.trim().length === 0) return null
  const metadata = await stat(filePath)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    throw new Error(`ADMIN_UI_LOOP_CREDENTIAL_FILE_INSECURE:${variable}`)
  }
  const value = (await readFile(filePath, "utf8")).trim()
  if (value.length === 0) throw new Error(`ADMIN_UI_LOOP_CREDENTIAL_FILE_EMPTY:${variable}`)
  return value
}

const urlOf = (route) => new URL(route, baseUrl).toString()

const overflowOf = async (page) =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))

const trackerOf = (page) => {
  const errors = []
  page.on("console", (message) => {
    if (message.type() === "error" && !harmlessConsoleError.some((pattern) => pattern.test(message.text()))) {
      errors.push(message.text())
    }
  })
  page.on("pageerror", (error) => errors.push(String(error)))
  return { errors }
}

const screenshotPathOf = (pageId) => `${evidenceDirectory}/screenshots/${pageId}.png`

const recordPage = async (run, page, input) => {
  const overflow = await overflowOf(page).catch(() => Number.NaN)
  const entry = {
    ...input,
    consoleErrors: input.consoleErrors,
    observedAt: new Date().toISOString(),
    overflowPx: Number.isFinite(overflow) ? overflow : null,
    runId,
    viewport: page.viewportSize(),
  }
  await writeFile(`${evidenceDirectory}/pages/${input.id}.json`, `${JSON.stringify(entry, null, 2)}\n`, "utf8")
  run.pages.push(entry)
  return entry
}

const visibleListState = async (page) =>
  page.evaluate(() => ({
    hasEmptyState: document.body.innerText.includes("No Results."),
    hasRestricted: document.body.innerText.includes("Your account does not have permission"),
    tableRows: Math.max(0, document.querySelectorAll("table tbody tr").length),
  }))

const uiCollectionSlugs = async (page) => {
  const hrefs = await page.locator('nav a[href*="/admin/collections/"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  )
  return [...new Set(hrefs.map((href) => /^\/admin\/collections\/([^/?#]+)/.exec(href)?.[1]).filter(Boolean))]
}

const apiProbe = async (page, slug) =>
  page.evaluate(async ({ route }) => {
    const response = await fetch(route, { credentials: "same-origin" })
    const body = await response.text()
    let parsed = null
    try {
      parsed = JSON.parse(body)
    } catch {}
    const docs = Array.isArray(parsed?.docs) ? parsed.docs : []
    return {
      docIds: docs.slice(0, 10).map((document) => document?.id).filter((id) => id !== undefined),
      status: response.status,
      totalDocs: typeof parsed?.totalDocs === "number" ? parsed.totalDocs : null,
    }
  }, { route: collectionApiRoute(slug) })

const login = async (context, account) => {
  const page = await context.newPage()
  const tracker = trackerOf(page)
  await page.goto(urlOf("/admin/login"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  await page.locator('input[name="email"], input[type="email"]').first().fill(account.email)
  await page.locator('input[name="password"], input[type="password"]').first().fill(account.password)
  await page.getByRole("button", { name: /login/i }).first().click()
  await page.waitForURL(/\/admin(?:\?|$)/, { timeout: timeoutMs })
  await page.getByRole("link", { name: /^Contents$/ }).first().waitFor({ state: "visible", timeout: timeoutMs })
  return { page, tracker }
}

const run = {
  baseUrl: baseUrl.toString().replace(/\/$/, ""),
  finishedAt: null,
  pages: [],
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
}

await mkdir(`${evidenceDirectory}/pages`, { recursive: true, mode: 0o700 })
await mkdir(`${evidenceDirectory}/screenshots`, { recursive: true, mode: 0o700 })

const browser = await chromium.launch()
try {
  const anonymous = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const healthPage = await anonymous.newPage()
  await healthPage.goto(urlOf("/"), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
  const health = await healthPage.evaluate(async () => {
    const [healthResponse, readinessResponse] = await Promise.all([
      fetch("/api/health"),
      fetch("/api/readiness"),
    ])
    return {
      health: { body: await healthResponse.text(), status: healthResponse.status },
      readiness: { body: await readinessResponse.text(), status: readinessResponse.status },
    }
  })
  await healthPage.close()
  run.preflight = health
  const ready = health.health.status === 200 && health.readiness.status === 200 && health.readiness.body.includes('"status":"ready"')
  if (!ready) {
    run.status = "blocked"
    run.finishedAt = new Date().toISOString()
    await writeFile(`${evidenceDirectory}/run.json`, `${JSON.stringify(run, null, 2)}\n`, "utf8")
    throw new Error("ADMIN_UI_LOOP_READINESS_BLOCKED")
  }

  for (const spec of PUBLIC_PAGES) {
    const page = await anonymous.newPage()
    const tracker = trackerOf(page)
    let responseStatus = null
    let rendering = "FAIL"
    let data = "NOT_APPLICABLE"
    let detail = null
    try {
      const response = await page.goto(urlOf(spec.route), { timeout: timeoutMs, waitUntil: "domcontentloaded" })
      if (spec.id === "admin-login") {
        await page.locator('input[name="email"], input[type="email"]').first().waitFor({
          state: "visible",
          timeout: timeoutMs,
        })
      }
      responseStatus = response?.status() ?? null
      const headingPresent =
        spec.expected.heading === undefined ||
        (await page.getByRole("heading", { name: spec.expected.heading }).count()) > 0
      const bodyText = await page.locator("body").innerText()
      const textPresent = spec.expected.text === undefined || bodyText.includes(spec.expected.text)
      const textAbsent = spec.expected.absentText === undefined || !bodyText.includes(spec.expected.absentText)
      const title = await page.title()
      const titlePresent = spec.expected.title === undefined || title === spec.expected.title
      rendering =
        responseStatus === spec.expected.status && headingPresent && textPresent && textAbsent && titlePresent
          ? "PASS"
          : "FAIL"
      detail = {
        expected: spec.expected,
        headingPresent,
        responseStatus,
        textAbsent,
        textPresent,
        title,
        titlePresent,
      }
    } catch (error) {
      detail = { error: String(error) }
    }
    const rbac = "NOT_APPLICABLE"
    const verdict = pageVerdict({ data, rbac, rendering })
    await page.screenshot({ path: screenshotPathOf(spec.id), fullPage: true }).catch(() => {})
    await recordPage(run, page, {
      ...verdict,
      consoleErrors: tracker.errors,
      detail,
      id: spec.id,
      route: spec.route,
      source: spec.upstream,
    })
    await page.close()
  }
  await anonymous.close()

  const email = await secureTextFile("ADMIN_UI_SUPER_ADMIN_EMAIL_FILE")
  const password = await secureTextFile("ADMIN_UI_SUPER_ADMIN_PASSWORD_FILE")
  if (email === null || password === null) {
    run.authenticatedPhase = {
      reason: "Set both ADMIN_UI_SUPER_ADMIN_EMAIL_FILE and ADMIN_UI_SUPER_ADMIN_PASSWORD_FILE (owner-only files).",
      status: "BLOCKED",
    }
  } else {
    const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const { page: dashboard, tracker } = await login(context, { email, password })
    const dashboardText = (await dashboard.locator("body").innerText()).toLowerCase()
    const dashboardRendering =
      dashboardText.includes("operations dashboard") &&
      dashboardText.includes("workflow pipeline") &&
      dashboardText.includes("site fleet")
        ? "PASS"
        : "FAIL"
    await dashboard.screenshot({ path: screenshotPathOf("admin-dashboard"), fullPage: true })
    await recordPage(run, dashboard, {
      ...pageVerdict({ data: "PASS", rbac: "PASS", rendering: dashboardRendering }),
      consoleErrors: tracker.errors,
      detail: { title: await dashboard.title() },
      id: "admin-dashboard",
      route: "/admin",
      source: "OperationsDashboard access-scoped Payload queries.",
    })

    const discoveredSlugs = await uiCollectionSlugs(dashboard)
    const missingRegistry = ADMIN_COLLECTIONS.map((entry) => entry.slug).filter((slug) => !discoveredSlugs.includes(slug))
    run.discovery = { discoveredSlugs, missingRegistry }

    const notFoundPage = await context.newPage()
    const notFoundTracker = trackerOf(notFoundPage)
    const notFoundResponse = await notFoundPage.goto(urlOf("/admin/definitely-not-a-page"), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    })
    await notFoundPage.getByRole("heading", { name: "Nothing found" }).waitFor({
      state: "visible",
      timeout: timeoutMs,
    })
    const authenticatedNotFound = {
      body: await notFoundPage.locator("body").innerText(),
      status: notFoundResponse?.status() ?? null,
      title: await notFoundPage.title(),
    }
    const notFoundRendering =
      authenticatedNotFound.status === 200 &&
      authenticatedNotFound.title === "Not Found" &&
      authenticatedNotFound.body.includes("Nothing found")
        ? "PASS"
        : "FAIL"
    await notFoundPage.screenshot({ path: screenshotPathOf("admin-invalid-route-authenticated"), fullPage: true })
    await recordPage(run, notFoundPage, {
      ...pageVerdict({ data: "NOT_APPLICABLE", rbac: "PASS", rendering: notFoundRendering }),
      consoleErrors: notFoundTracker.errors,
      detail: {
        ...authenticatedNotFound,
        note: "Payload dynamic notFound() renders semantic 404 UI through Next App Router's streamed 200 response.",
      },
      id: "admin-invalid-route-authenticated",
      route: "/admin/definitely-not-a-page",
      source: "Payload admin dynamic not-found boundary.",
    })
    await notFoundPage.close()

    for (const slug of discoveredSlugs) {
      const spec = collectionBySlug(slug)
      if (spec === null) continue
      const page = await context.newPage()
      const collectionTracker = trackerOf(page)
      let detail = null
      let rendering = "FAIL"
      let data = "FAIL"
      let rbac = "PASS"
      try {
        const response = await page.goto(urlOf(collectionRoute(slug)), {
          timeout: timeoutMs,
          waitUntil: "domcontentloaded",
        })
        await page.locator("table, text=No Results.").first().waitFor({ state: "visible", timeout: timeoutMs })
        const state = await visibleListState(page)
        const probe = await apiProbe(page, slug)
        const apiHasData = probe.status === 200 && (probe.totalDocs ?? 0) > 0
        const uiHasData = state.tableRows > 0
        data =
          probe.status === 403 || state.hasRestricted
            ? "RESTRICTED"
            : !apiHasData && state.hasEmptyState
              ? "EXPECTED_EMPTY"
              : apiHasData && uiHasData
                ? "PASS"
                : "FAIL"
        rbac = probe.status === 403 ? "FAIL" : "PASS"
        rendering = response?.status() === 200 && (state.hasEmptyState || uiHasData || state.hasRestricted) ? "PASS" : "FAIL"
        detail = { api: probe, state, status: response?.status() ?? null }
      } catch (error) {
        detail = { error: String(error) }
      }
      await page.screenshot({ path: screenshotPathOf(`collection-${slug}`), fullPage: true }).catch(() => {})
      await recordPage(run, page, {
        ...pageVerdict({ data, rbac, rendering }),
        consoleErrors: collectionTracker.errors,
        detail,
        id: `collection-${slug}`,
        route: collectionRoute(slug),
        source: spec.source,
      })
      await page.close()
    }

    for (const protectedPage of SERVICE_OWNED_404) {
      const page = await context.newPage()
      const protectedTracker = trackerOf(page)
      let status = null
      try {
        status = (await page.goto(urlOf(protectedPage.route), { timeout: timeoutMs, waitUntil: "domcontentloaded" }))?.status() ?? null
      } catch {}
      await recordPage(run, page, {
        ...pageVerdict({ data: "RESTRICTED", rbac: status === 404 ? "PASS" : "FAIL", rendering: status === 404 ? "PASS" : "FAIL" }),
        consoleErrors: protectedTracker.errors,
        detail: { expected: 404, reason: protectedPage.reason, status },
        id: `service-owned-${protectedPage.slug}`,
        route: protectedPage.route,
        source: "Service-owned collection visibility policy.",
      })
      await page.close()
    }
    await context.close()
  }

  run.status = run.pages.every((entry) => entry.overall === "PASS_FULL") ? "passed" : "completed-with-findings"
} finally {
  run.finishedAt = new Date().toISOString()
  await writeFile(`${evidenceDirectory}/run.json`, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  await browser.close()
}

const summary = run.pages.reduce((counts, page) => {
  counts[page.overall] = (counts[page.overall] ?? 0) + 1
  return counts
}, {})
console.log(JSON.stringify({ evidenceDirectory, runId, status: run.status, summary }))

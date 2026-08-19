#!/usr/bin/env node
// /admin/login 空白页诊断:console、页面错误、失败请求、React 挂载探针
import { chromium } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3090"

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { height: 800, width: 1280 } })
const page = await context.newPage()
await page.addInitScript(() => {
  window.__errors = []
  window.addEventListener("error", (event) =>
    window.__errors.push(`error: ${String(event.message).slice(0, 300)}`),
  )
  window.addEventListener("unhandledrejection", (event) =>
    window.__errors.push(`rejection: ${String(event.reason).slice(0, 300)}`),
  )
})

const consoleMessages = []
const pageErrors = []
const failedRequests = []
page.on("console", (message) => {
  consoleMessages.push(`${message.type()}: ${message.text().slice(0, 300)}`)
})
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 500)))
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`),
)
page.on("response", (response) => {
  if (response.status() >= 400) {
    failedRequests.push(`HTTP ${response.status()} ${response.url()}`)
  }
})

await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 45_000 })
await page.waitForTimeout(10_000)

const requested = await page.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/_next/static/chunks/"))
    .map((entry) => entry.name.split("/").at(-1)),
)
const fibers = await page.evaluate(() => {
  const withFiber = []
  for (const element of document.body.querySelectorAll("*")) {
    for (const key of Object.keys(element)) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$")) {
        withFiber.push(
          `${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""} ${key.startsWith("__reactContainer$") ? "CONTAINER" : "fiber"}`,
        )
        break
      }
    }
    if (withFiber.length >= 8) break
  }
  return withFiber
})
const live = await page.evaluate(() => ({
  brandDiv: Boolean(document.querySelector(".login__brand")),
  formDiv: Boolean(document.querySelector(".login__form")),
  sectionChildren: document.querySelector("section")?.children.length ?? -1,
  sectionClass: document.querySelector("section")?.className?.slice(0, 80) ?? null,
}))
const sectionFiber = await page.evaluate(() => {
  const section = document.querySelector("section")
  if (!section) return { found: false }
  const fiberKey = Object.keys(section).find((key) => key.startsWith("__reactFiber$"))
  if (!fiberKey) return { found: true, fiber: false }
  const fiber = section[fiberKey]
  const chain = []
  let node = fiber
  for (let depth = 0; node !== null && depth < 14; depth += 1) {
    const type = node.type
    if (typeof type === "function" || typeof type === "object") {
      const named =
        type && (type.name || type.displayName || (type.$$typeof ? "lazy/forward" : "obj"))
      chain.push(
        `${depth}: ${String(named)} props=${JSON.stringify(Object.keys(node.memoizedProps ?? {})).slice(0, 140)}`,
      )
    } else if (typeof type === "string") {
      chain.push(
        `${depth}: <${type}> children=${Array.isArray(node.memoizedProps?.children) ? node.memoizedProps.children.length : node.memoizedProps?.children === null ? "null" : "single"}`,
      )
    }
    node = node.return
  }
  return { chain, found: true, fiber: true }
})
const probe = await page.evaluate(() => ({
  bodyChildCount: document.body.children.length,
  firstBodyChildren: [...document.body.children]
    .slice(0, 6)
    .map((element) =>
      element.id
        ? `<${element.tagName.toLowerCase()} id=${element.id}>`
        : element.tagName.toLowerCase(),
    ),
  inputCount: document.querySelectorAll("input,button,form").length,
  nextFScripts: document.querySelectorAll("script").length,
  reactRootMarked: Boolean(document.querySelector("[data-reactroot], #__next, #portal")),
  bodyTextSnippet: document.body.innerText.slice(0, 200),
}))

const initErrors = await page.evaluate(() => window.__errors ?? [])
console.log(
  JSON.stringify(
    {
      consoleMessages,
      failedRequests,
      initErrors,
      pageErrors,
      live,
      probe,
      reactAttachments: fibers,
      requestedChunks: requested,
      sectionFiber,
    },
    null,
    2,
  ),
)
await browser.close()

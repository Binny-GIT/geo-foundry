import { test as base, expect, devices } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import {
  assertArticleJsonLd,
  assertCanonicalDomain,
  assertNoBrandLeak,
  assertSitemapScope,
  assertServerRenderedBody,
  parseJsonLd,
} from "./assertions.mjs"
import { readE2eState, requestHost, writeEvidence, writeTextEvidence } from "./support.mjs"

const state = await readE2eState()

const contextOptionsOf = (projectName) => {
  const device = projectName.endsWith("mobile") ? devices["Pixel 7"] : devices["Desktop Chrome"]
  const { defaultBrowserType, ...options } = device
  void defaultBrowserType
  return options
}

const siteOf = (projectName) => (projectName.startsWith("site-a-") ? state.siteA : state.siteB)
const otherSiteOf = (projectName) => (projectName.startsWith("site-a-") ? state.siteB : state.siteA)

const urlOf = (site, pathname) => `http://${site.host}:${site.port}${pathname}`

const headingLevels = async (page) =>
  page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))))

const assertHeadingOrder = (levels) => {
  if (levels.filter((level) => level === 1).length !== 1) {
    throw new Error("E2E_HEADING_H1_INVALID")
  }
  for (let index = 1; index < levels.length; index += 1) {
    if ((levels[index] ?? 1) > (levels[index - 1] ?? 1) + 1) {
      throw new Error("E2E_HEADING_ORDER_INVALID")
    }
  }
}

const captureRawArticle = async (site, projectName) => {
  const response = await requestHost({ host: site.host, path: site.pathname, port: site.port })
  expect(response.status).toBe(200)
  expect(response.headers["x-geo-release-id"]).toBe(site.releaseId)
  await writeTextEvidence(state, `raw-ssr/${projectName}-${site.host}-article.html`, response.body)
  return response.body
}

const test = base.extend({
  e2ePage: async ({ browser }, use, testInfo) => {
    const site = siteOf(testInfo.project.name)
    const context = await browser.newContext({
      ...contextOptionsOf(testInfo.project.name),
      locale: "en-US",
      recordHar: {
        mode: "minimal",
        path: `${state.evidenceDirectory}/har/${testInfo.project.name}.har`,
      },
      timezoneId: "UTC",
    })
    const page = await context.newPage()
    await use({ page, site })
    await context.close()
  },
})

test("renders semantic no-JS SSR article and listing with site isolation", async ({
  browser,
  e2ePage,
}, testInfo) => {
  const { page, site } = e2ePage
  const otherSite = otherSiteOf(testInfo.project.name)
  const rawHtml = await captureRawArticle(site, testInfo.project.name)
  assertServerRenderedBody(rawHtml, site.title)
  assertNoBrandLeak(rawHtml, otherSite.siteName)
  if (site === state.siteA) {
    expect(rawHtml).not.toContain("_next")
  }

  const noJavaScript = await browser.newContext({
    ...contextOptionsOf(testInfo.project.name),
    javaScriptEnabled: false,
  })
  const noJavaScriptPage = await noJavaScript.newPage()
  await noJavaScriptPage.goto(urlOf(site, site.pathname), { waitUntil: "domcontentloaded" })
  await expect(noJavaScriptPage.locator("main article")).toContainText(site.title)
  await expect(noJavaScriptPage.locator("h1")).toHaveText(site.title)
  await noJavaScript.close()

  await page.goto(urlOf(site, site.pathname), { waitUntil: "domcontentloaded" })
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.locator("main")).toBeVisible()
  await expect(page.locator("main article")).toBeVisible()
  await expect(page.locator("header[data-site-a-header], header[data-site-b-header]")).toBeVisible()
  await expect(page.locator("footer[data-site-a-footer], footer[data-site-b-footer]")).toBeVisible()
  await expect(page.locator("h1")).toHaveText(site.title)
  assertHeadingOrder(await headingLevels(page))
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `https://${site.host}${site.pathname}`,
  )
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow")
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    `https://${site.host}${site.pathname}`,
  )
  const jsonLd = parseJsonLd(
    await page.locator('script[type="application/ld+json"]').allTextContents(),
  )
  const canonicalUrl = `https://${site.host}${site.pathname}`
  assertArticleJsonLd(jsonLd, {
    canonicalUrl,
    hostname: site.host,
    title: site.title,
  })
  await writeEvidence(state, `json-ld/${testInfo.project.name}-article.json`, {
    canonicalUrl,
    nodes: jsonLd,
  })
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations).toEqual([])
  await writeEvidence(state, `axe/${testInfo.project.name}-article.json`, axe)
  await page.screenshot({
    fullPage: true,
    path: `${state.evidenceDirectory}/screenshots/${testInfo.project.name}-article.png`,
  })
  await expect(page).toHaveScreenshot(`${testInfo.project.name}-article.png`, { fullPage: true })

  await page.goto(urlOf(site, "/articles"), { waitUntil: "domcontentloaded" })
  await expect(page.locator("main")).toContainText(site.title)
  await expect(page.locator("h1")).toHaveCount(1)
  assertHeadingOrder(await headingLevels(page))
  const listingAxe = await new AxeBuilder({ page }).analyze()
  expect(listingAxe.violations).toEqual([])
  await writeEvidence(state, `axe/${testInfo.project.name}-listing.json`, listingAxe)
  await page.screenshot({
    fullPage: true,
    path: `${state.evidenceDirectory}/screenshots/${testInfo.project.name}-listing.png`,
  })
  await expect(page).toHaveScreenshot(`${testInfo.project.name}-listing.png`, { fullPage: true })
})

test("serves canonical aliases, redirect SEO, 404 metadata and sitemap evidence", async ({
  e2ePage,
}, testInfo) => {
  const { page, site } = e2ePage
  const aliasUrl = `http://${site.alias}:${site.port}${site.pathname}`
  await page.goto(aliasUrl, { waitUntil: "domcontentloaded" })
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `https://${site.host}${site.pathname}`,
  )

  const redirect = await requestHost({ host: site.host, path: site.oldPathname, port: site.port })
  expect(redirect.status).toBe(301)
  expect(redirect.headers.location).toBe(`https://${site.host}${site.pathname}`)
  expect(redirect.body).toContain(`https://${site.host}${site.oldPathname}`)
  expect(
    /name="robots"[^>]*content="noindex,follow"|content="noindex,follow"[^>]*name="robots"/.test(
      redirect.body,
    ),
  ).toBe(true)
  expect(redirect.body).not.toContain("application/ld+json")
  await writeTextEvidence(
    state,
    `raw-ssr/${testInfo.project.name}-${site.host}-redirect.html`,
    redirect.body,
  )

  await page.goto(urlOf(site, "/missing"), { waitUntil: "domcontentloaded" })
  await expect(page.locator("h1")).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow")
  const missingJsonLd = parseJsonLd(
    await page.locator('script[type="application/ld+json"]').allTextContents(),
  )
  expect(missingJsonLd.some((node) => (node.type ?? node["@type"]) === "WebPage")).toBe(true)
  await writeEvidence(state, `json-ld/${testInfo.project.name}-not-found.json`, {
    canonicalUrl: `https://${site.host}/missing`,
    nodes: missingJsonLd,
  })
  const missingAxe = await new AxeBuilder({ page }).analyze()
  expect(missingAxe.violations).toEqual([])
  await writeEvidence(state, `axe/${testInfo.project.name}-not-found.json`, missingAxe)

  const sitemap = await requestHost({ host: site.host, path: "/sitemap.xml", port: site.port })
  expect(sitemap.status).toBe(200)
  expect(sitemap.headers["x-geo-release-id"]).toBe(site.releaseId)
  assertSitemapScope(sitemap.body, {
    forbidden: [
      `https://${site.host}${site.oldPathname}`,
      `https://${site.host}${site.gonePathname}`,
    ],
    forbiddenHosts: [otherSiteOf(testInfo.project.name).host],
    required: [`https://${site.host}${site.pathname}`],
  })
  await writeTextEvidence(state, `sitemaps/${testInfo.project.name}-${site.host}.xml`, sitemap.body)

  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href")
  assertCanonicalDomain(canonical ?? "", site.host)
})

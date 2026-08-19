import { describe, expect, it } from "vitest"

import {
  COMPILER_ERROR,
  buildRoutingManifest,
  compileSite,
  type CompileEdition,
  type CompileRequest,
  type CompileSite,
} from "../src/index.js"

const siteOf = (over: Partial<CompileSite>): CompileSite => ({
  canonicalDomain: "site-a.test",
  locale: "en-US",
  name: "Site A",
  organization: { logoUrl: "/media/logo.svg", name: "Site A Media" },
  seoDefaults: { description: "Site A default description.", title: "Site A" },
  siteId: "site-a",
  timezone: "UTC",
  ...over,
})

const editionOf = (over: Partial<CompileEdition>): CompileEdition => ({
  articleKind: "article",
  assessmentInputHash: "a".repeat(64),
  assessmentState: "passed",
  author: { id: "author-ada", name: "Ada Chen", url: "https://site-a.test/authors/ada-chen" },
  body: [{ blockType: "paragraph", text: "Body." }],
  categories: ["guides"],
  contentId: 12,
  editionId: 101,
  media: [],
  modifiedAt: "2026-08-17T11:00:00Z",
  publishedAt: "2026-08-17T10:00:00Z",
  siteId: "site-a",
  status: "approved",
  summary: "Summary.",
  tags: ["contracts"],
  title: "Title",
  urlPathname: "/guides/release-gates",
  urlStatus: "active",
  ...over,
})

const requestOf = (
  site: CompileSite,
  editions: readonly CompileEdition[],
  redirects: CompileRequest["redirects"],
): CompileRequest => ({
  clock: { now: "2026-08-19T00:00:00Z" },
  compilerVersion: "geo-compiler-1",
  otherSiteDomains: ["site-a.test", "site-b.test"].filter(
    (domain) => domain !== site.canonicalDomain,
  ),
  editions,
  listings: {
    articles: { pathname: "/articles", pageSize: 10 },
    categories: editions[0]
      ? [
          {
            id: "cat-1",
            pathname: "/topics",
            slug: editions[0].categories[0] ?? "guides",
            title: "Topics",
          },
        ]
      : [],
    tags: [],
  },
  notFound: { pathname: "/not-found" },
  redirects,
  site,
})

describe("two-site acceptance", () => {
  const siteA = siteOf({})
  const siteB = siteOf({
    canonicalDomain: "site-b.test",
    name: "Site B",
    organization: { logoUrl: "/media/logo-b.svg", name: "Site B Media" },
    seoDefaults: { description: "Site B default description.", title: "Site B" },
    siteId: "site-b",
  })
  const editionsA = [editionOf({})]
  const editionsB = [
    editionOf({
      author: { id: "author-lin", name: "Lin Zhao", url: "https://site-b.test/authors/lin-zhao" },
      categories: ["news"],
      editionId: 201,
      siteId: "site-b",
      title: "Site B article",
      urlPathname: "/news/first",
    }),
  ]

  it("compiles both sites with separate routes and sitemaps that never cross", async () => {
    const a = await compileSite(requestOf(siteA, editionsA, []))
    const b = await compileSite(requestOf(siteB, editionsB, []))
    for (const output of [a, b]) {
      expect(output.routeIndex.routes).toHaveLength(output.documents.length)
      for (const route of output.routeIndex.routes) {
        const document = output.documents.find((entry) => entry.pathname === route.pathname)
        expect(document, `${route.pathname} exists as a document`).toBeDefined()
      }
    }
    expect(a.routeIndex.siteId).toBe("site-a")
    expect(b.routeIndex.siteId).toBe("site-b")
    expect(a.sitemap).not.toContain("site-b.test")
    expect(b.sitemap).not.toContain("site-a.test")
    expect(a.sitemap).toContain("https://site-a.test/guides/release-gates")
    expect(b.sitemap).toContain("https://site-b.test/news/first")
  })

  it("maps host aliases of both sites onto one routing manifest", () => {
    const manifest = buildRoutingManifest([
      {
        canonicalDomain: siteA.canonicalDomain,
        hostAliases: ["www.site-a.test"],
        siteId: "site-a",
      },
      { canonicalDomain: siteB.canonicalDomain, siteId: "site-b" },
    ])
    expect(manifest.hosts.map((host) => [host.host, host.siteId])).toEqual([
      ["site-a.test", "site-a"],
      ["site-b.test", "site-b"],
      ["www.site-a.test", "site-a"],
    ])
  })

  it("blocks a cross-site redirect leak between the two sites", async () => {
    await expect(
      compileSite(
        requestOf(siteA, editionsA, [
          { fromPathname: "/moved", targetUrl: "https://site-b.test/news/first" },
        ]),
      ),
    ).rejects.toMatchObject({
      code: COMPILER_ERROR.ROUTE_CROSS_SITE_REFERENCE,
    })
  })
})

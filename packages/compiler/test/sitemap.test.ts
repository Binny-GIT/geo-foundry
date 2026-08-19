import { describe, expect, it } from "vitest"

import {
  COMPILER_ERROR,
  assertPageInRange,
  buildSitemapXml,
  listingPagePathname,
  paginateListing,
} from "../src/index.js"

const expectCode = (act: () => unknown, code: string) =>
  expect(act).toThrowError(expect.objectContaining({ code }))

describe("listing pagination", () => {
  it("slices sorted items into contiguous pages with prev/next chains", () => {
    const pages = paginateListing({
      basePathname: "/articles",
      items: ["a", "b", "c", "d", "e"],
      pageSize: 2,
    })
    expect(pages.map((page) => [page.pathname, page.items, page.page])).toEqual([
      ["/articles", ["a", "b"], 1],
      ["/articles/page/2", ["c", "d"], 2],
      ["/articles/page/3", ["e"], 3],
    ])
    expect(pages[0]).toMatchObject({ nextPathname: "/articles/page/2", pageCount: 3 })
    expect(pages[1]).toMatchObject({
      nextPathname: "/articles/page/3",
      previousPathname: "/articles",
    })
    expect(pages[2]).toMatchObject({ previousPathname: "/articles/page/2" })
    expect(pages[0]?.totalItems).toBe(5)
    expect("previousPathname" in (pages[0] ?? {})).toBe(false)
  })

  it("keeps exactly one page for empty listings", () => {
    const pages = paginateListing({ basePathname: "/tags", items: [], pageSize: 20 })
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ items: [], page: 1, pathname: "/tags" })
  })

  it("rejects non-positive page sizes and out-of-range pages (gaps)", () => {
    expectCode(
      () => paginateListing({ basePathname: "/a", items: [1], pageSize: 0 }),
      COMPILER_ERROR.PAGINATION_INVALID,
    )
    expectCode(() => assertPageInRange(3, 2, "/a"), COMPILER_ERROR.PAGINATION_INVALID)
    expectCode(() => assertPageInRange(0, 2, "/a"), COMPILER_ERROR.PAGINATION_INVALID)
  })

  it("derives deterministic page pathnames", () => {
    expect(listingPagePathname("/articles", 1)).toBe("/articles")
    expect(listingPagePathname("/articles", 4)).toBe("/articles/page/4")
  })
})

describe("sitemap XML", () => {
  it("emits sorted urlset entries with canonical locs and escaped values", () => {
    const xml = buildSitemapXml({
      canonicalDomain: "site-a.test",
      urls: [
        { lastmod: "2026-08-18T09:00:00Z", pathname: "/news/launch" },
        { pathname: "/articles" },
        { lastmod: "2026-08-17T10:00:00Z", pathname: "/guides/a&b<c>" },
      ],
    })
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "<url><loc>https://site-a.test/articles</loc></url>",
        "<url><loc>https://site-a.test/guides/a&amp;b&lt;c&gt;</loc><lastmod>2026-08-17T10:00:00Z</lastmod></url>",
        "<url><loc>https://site-a.test/news/launch</loc><lastmod>2026-08-18T09:00:00Z</lastmod></url>",
        "</urlset>",
        "",
      ].join("\n"),
    )
  })

  it("rejects duplicate entries, malformed lastmod, and control characters", () => {
    expectCode(
      () =>
        buildSitemapXml({
          canonicalDomain: "site-a.test",
          urls: [{ pathname: "/a" }, { pathname: "/a" }],
        }),
      COMPILER_ERROR.SITEMAP_XML_INVALID,
    )
    expectCode(
      () =>
        buildSitemapXml({
          canonicalDomain: "site-a.test",
          urls: [{ lastmod: "2026-08-17T10:00:00+02:00", pathname: "/a" }],
        }),
      COMPILER_ERROR.INSTANT_NOT_UTC,
    )
    expectCode(
      () =>
        buildSitemapXml({
          canonicalDomain: "site-a.test",
          urls: [{ pathname: "/bad\u0007bell" }],
        }),
      COMPILER_ERROR.SITEMAP_XML_INVALID,
    )
  })
})

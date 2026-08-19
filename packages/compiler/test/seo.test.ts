import { describe, expect, it } from "vitest"

import {
  assertDateOrder,
  assertRedirectTarget,
  assertUrlOnCanonicalDomain,
  assetUrlOf,
  buildSeo,
  COMPILER_ERROR,
  canonicalDomainOf,
  canonicalUrlOf,
  verifySeoConsistency,
} from "../src/index.js"

const site = { canonicalDomain: "site-a.test" }

const expectCode = (act: () => unknown, code: string) =>
  expect(act).toThrowError(expect.objectContaining({ code }))

describe("canonical URL derivation", () => {
  it("derives absolute https canonical URLs from the canonical domain", () => {
    expect(canonicalUrlOf(site, "/guides/release-gates")).toBe(
      "https://site-a.test/guides/release-gates",
    )
    expect(canonicalUrlOf(site, "/")).toBe("https://site-a.test/")
  })

  it("normalizes the domain but rejects hostnames carrying scheme, port, or underscores", () => {
    expect(canonicalDomainOf({ canonicalDomain: "Site-A.Test " })).toBe("site-a.test")
    for (const bad of ["https://site-a.test", "site-a.test:443", "site_a.test", "-site-a.test"]) {
      expectCode(
        () => canonicalDomainOf({ canonicalDomain: bad }),
        COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
      )
    }
  })

  it("rejects pathnames that are not site-absolute", () => {
    expectCode(() => canonicalUrlOf(site, "guides"), COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN)
  })
})

describe("URL domain ownership", () => {
  it("accepts canonical-domain urls and normalizes host case", () => {
    expect(assertUrlOnCanonicalDomain(site, "https://SITE-a.test/x?y=1", "field")).toBe(
      "https://site-a.test/x?y=1",
    )
  })

  it("rejects foreign hosts and plain http", () => {
    expectCode(
      () => assertUrlOnCanonicalDomain(site, "https://site-b.test/x", "field"),
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
    )
    expectCode(
      () => assertUrlOnCanonicalDomain(site, "http://site-a.test/x", "field"),
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
    )
  })

  it("resolves site-relative asset paths and rejects foreign asset urls", () => {
    expect(assetUrlOf(site, "/media/map.webp", "asset")).toBe("https://site-a.test/media/map.webp")
    expectCode(
      () => assetUrlOf(site, "https://cdn.test/map.webp", "asset"),
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
    )
  })
})

describe("redirect target semantics", () => {
  it("resolves relative targets onto the canonical domain", () => {
    expect(assertRedirectTarget(site, "/old-guides", "/guides")).toBe("https://site-a.test/guides")
  })

  it("keeps cross-domain https targets untouched", () => {
    expect(assertRedirectTarget(site, "/old", "https://elsewhere.test/moved")).toBe(
      "https://elsewhere.test/moved",
    )
  })

  it("rejects redirects targeting their own canonical URL", () => {
    expectCode(
      () => assertRedirectTarget(site, "/old-guides", "https://site-a.test/old-guides"),
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
    )
  })

  it("rejects non-https and malformed targets", () => {
    expectCode(
      () => assertRedirectTarget(site, "/old", "http://site-a.test/new"),
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
    )
    expectCode(
      () => assertRedirectTarget(site, "/old", "not-a-url"),
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
    )
  })
})

describe("buildSeo", () => {
  const base = {
    canonicalUrl: "https://site-a.test/a",
    description: "Visible description.",
    openGraphType: "website" as const,
    pageType: "article" as const,
    robots: { follow: true, index: true },
    title: "Visible title",
  }

  it("mirrors visible title/description into every surface", () => {
    const seo = buildSeo(base)
    expect(seo).toMatchObject({
      description: "Visible description.",
      openGraph: { description: "Visible description.", title: "Visible title" },
      title: "Visible title",
      twitter: { description: "Visible description.", title: "Visible title" },
    })
    expect(seo.twitter.card).toBe("summary")
    expect("image" in seo.openGraph).toBe(false)
  })

  it("switches to a large card with an absolute image", () => {
    const seo = buildSeo({ ...base, imageUrl: "https://site-a.test/media/map.webp" })
    expect(seo.openGraph.image).toBe("https://site-a.test/media/map.webp")
    expect(seo.twitter).toMatchObject({
      card: "summary_large_image",
      image: "https://site-a.test/media/map.webp",
    })
  })

  it("rejects indexable redirect or not-found robots", () => {
    expectCode(
      () =>
        buildSeo({
          ...base,
          pageType: "redirect",
          robots: { follow: true, index: true },
        }),
      COMPILER_ERROR.SEO_ROBOTS_CONFLICT,
    )
    expectCode(
      () =>
        buildSeo({
          ...base,
          pageType: "not-found",
          robots: { follow: false, index: true },
        }),
      COMPILER_ERROR.SEO_ROBOTS_CONFLICT,
    )
  })
})

describe("date order", () => {
  it("accepts equal instants and fractional seconds that sort wrongly as text", () => {
    expect(() =>
      assertDateOrder("2026-08-17T10:00:00Z", "2026-08-17T10:00:00Z", "edition 1"),
    ).not.toThrow()
    expect(() =>
      assertDateOrder("2026-08-17T10:00:00Z", "2026-08-17T10:00:00.500Z", "edition 1"),
    ).not.toThrow()
  })

  it("rejects modified preceding published", () => {
    expectCode(
      () => assertDateOrder("2026-08-17T10:00:01Z", "2026-08-17T10:00:00Z", "edition 1"),
      COMPILER_ERROR.SEO_DATE_ORDER_INVALID,
    )
  })
})

describe("verifySeoConsistency", () => {
  const page = {
    metadata: { description: "Visible description.", title: "Visible title" },
    pageType: "article",
    route: { canonicalUrl: "https://site-a.test/a" },
    seo: {
      description: "Visible description.",
      openGraph: { description: "Visible description.", title: "Visible title" },
      title: "Visible title",
      twitter: { description: "Visible description.", title: "Visible title" },
    },
    structuredData: [
      {
        headline: "Visible title",
        type: "Article",
        url: "https://site-a.test/a",
      },
    ],
  }

  it("accepts a page whose surfaces repeat the visible values", () => {
    expect(() => verifySeoConsistency(page)).not.toThrow()
  })

  it("flags drift on seo, openGraph, twitter, and JSON-LD fields", () => {
    expectCode(
      () => verifySeoConsistency({ ...page, seo: { ...page.seo, title: "Drifted" } }),
      COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION,
    )
    expectCode(
      () =>
        verifySeoConsistency({
          ...page,
          seo: { ...page.seo, openGraph: { ...page.seo.openGraph, title: "Drifted" } },
        }),
      COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION,
    )
    expectCode(
      () =>
        verifySeoConsistency({
          ...page,
          seo: { ...page.seo, twitter: { ...page.seo.twitter, description: "Drifted" } },
        }),
      COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION,
    )
    expectCode(
      () =>
        verifySeoConsistency({
          ...page,
          structuredData: [{ ...page.structuredData[0], headline: "Drifted headline" }],
        }),
      COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION,
    )
    expectCode(
      () =>
        verifySeoConsistency({
          ...page,
          structuredData: [{ ...page.structuredData[0], url: "https://site-a.test/other" }],
        }),
      COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION,
    )
  })
})

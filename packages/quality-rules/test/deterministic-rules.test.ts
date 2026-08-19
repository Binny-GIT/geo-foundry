import {
  articlePageFixture,
  redirectPageFixture,
  tagPageFixture,
  type ArticlePage,
  type ContentBlock,
  type PageDocument,
} from "@geo/schema"
import { describe, expect, it } from "vitest"

import {
  MIN_CONTENT_CHARS,
  SEO_DESCRIPTION_MAX_CHARS,
  SEO_TITLE_MAX_CHARS,
  runDeterministicRules,
  type QualityIssue,
} from "../src/index.js"

type Writable<T> = { -readonly [K in keyof T]: Writable<T[K]> }

const clone = <T>(value: T): Writable<T> => structuredClone(value) as unknown as Writable<T>

const REFERENCE_BLOCK: ContentBlock = {
  type: "references",
  items: [{ citationId: "citation-prd", label: "Product requirements" }],
}

const healthyDocument = (): Writable<ArticlePage> => {
  const document = clone(articlePageFixture)
  document.body = [...document.body, REFERENCE_BLOCK, { type: "paragraph", text: "x".repeat(400) }]
  return document
}

const issuesOf = (
  document: PageDocument,
  context?: Parameters<typeof runDeterministicRules>[0]["context"],
): readonly QualityIssue[] => runDeterministicRules({ context, document }).issues

const codesOf = (
  document: PageDocument,
  context?: { knownPathnames?: readonly string[] },
): readonly string[] => issuesOf(document, context).map((issue) => issue.code)

describe("deterministic rules: healthy fixture", () => {
  it("yields no issues at all for a complete article", () => {
    const document = healthyDocument()
    const context = {
      knownPathnames: ["/", "/guides", "/guides/related"],
    }
    expect(issuesOf(document, context)).toEqual([])
  })
})

describe("deterministic rules: seo", () => {
  it("flags a missing seo title, metadata title, and description", () => {
    const document = healthyDocument()
    document.seo.title = " "
    document.seo.description = ""
    document.metadata.title = ""
    expect(codesOf(document)).toEqual([
      "METADATA_TITLE_MISSING",
      "SEO_DESCRIPTION_MISSING",
      "SEO_TITLE_MISSING",
    ])
  })

  it("passes at the title and description boundaries and fails one character over", () => {
    const atBoundary = healthyDocument()
    atBoundary.seo.title = "t".repeat(SEO_TITLE_MAX_CHARS)
    atBoundary.seo.description = "d".repeat(SEO_DESCRIPTION_MAX_CHARS)
    expect(codesOf(atBoundary)).toEqual([])

    const overBoundary = healthyDocument()
    overBoundary.seo.title = "t".repeat(SEO_TITLE_MAX_CHARS + 1)
    overBoundary.seo.description = "d".repeat(SEO_DESCRIPTION_MAX_CHARS + 1)
    expect(codesOf(overBoundary)).toEqual(["SEO_DESCRIPTION_TOO_LONG", "SEO_TITLE_TOO_LONG"])
  })
})

describe("deterministic rules: canonical", () => {
  it("flags an invalid canonical URL", () => {
    const document = healthyDocument()
    document.route.canonicalUrl = "not-a-url"
    expect(codesOf(document)).toEqual(["CANONICAL_URL_INVALID"])
  })

  it("flags a canonical pathname mismatch but accepts a trailing-slash variant", () => {
    const mismatch = healthyDocument()
    mismatch.route.canonicalUrl = "https://site-a.test/other-path"
    expect(codesOf(mismatch)).toEqual(["CANONICAL_PATHNAME_MISMATCH"])

    const trailingSlash = healthyDocument()
    trailingSlash.route.pathname = "/guides/article"
    trailingSlash.route.canonicalUrl = "https://site-a.test/guides/article/"
    expect(codesOf(trailingSlash)).toEqual([])
  })
})

describe("deterministic rules: dates and sitemap", () => {
  it("flags modified before published, invalid timestamps, and missing sitemap lastmod", () => {
    const reversed = healthyDocument()
    reversed.metadata.publishedAt = "2026-08-17T11:00:00.000Z"
    reversed.metadata.modifiedAt = "2026-08-17T10:00:00.000Z"
    expect(codesOf(reversed)).toEqual(["DATES_MODIFIED_BEFORE_PUBLISHED"])

    const sameInstant = healthyDocument()
    sameInstant.metadata.publishedAt = "2026-08-17T10:00:00.000Z"
    sameInstant.metadata.modifiedAt = "2026-08-17T10:00:00.000Z"
    expect(codesOf(sameInstant)).toEqual([])

    const invalid = healthyDocument()
    invalid.metadata.publishedAt = "not-a-date"
    expect(codesOf(invalid)).toEqual(["DATES_PUBLISHED_INVALID"])

    const invalidModified = healthyDocument()
    invalidModified.metadata.modifiedAt = "not-a-date"
    expect(codesOf(invalidModified)).toEqual(["DATES_MODIFIED_INVALID"])

    const unindexed = healthyDocument()
    unindexed.metadata.publishedAt = undefined
    expect(codesOf(unindexed)).toEqual(["SITEMAP_PUBLISHED_MISSING"])
  })
})

describe("deterministic rules: json-ld", () => {
  it("flags malformed structured data and a missing Article node", () => {
    const malformed = healthyDocument()
    malformed.structuredData = [
      { type: "Article" } as Writable<ArticlePage["structuredData"]>[number],
    ]
    expect(codesOf(malformed)).toEqual(["JSONLD_SHAPE_INVALID"])

    const missingArticle = healthyDocument()
    missingArticle.structuredData = [
      { type: "WebPage", name: "Article", url: "https://site-a.test/guides/article" },
    ]
    expect(codesOf(missingArticle)).toEqual(["JSONLD_ARTICLE_MISSING"])

    const noStructuredData = healthyDocument()
    noStructuredData.structuredData = undefined
    expect(codesOf(noStructuredData)).toEqual(["JSONLD_ARTICLE_MISSING"])
  })
})

describe("deterministic rules: structure", () => {
  it("flags malformed and empty blocks at their exact indices", () => {
    const document = healthyDocument()
    const template = document.body[0]
    if (template === undefined) {
      throw new Error("healthy fixture must start with a block")
    }
    document.body = [
      { type: "mystery" } as unknown as Writable<ContentBlock>,
      template,
      { ...template, text: "" },
    ]
    const issues = issuesOf(document)
    const codes = issues.map((issue) => issue.code)
    expect(codes).toContain("BLOCK_MALFORMED")
    const malformed = issues.filter((issue) => issue.code === "BLOCK_MALFORMED")
    expect(malformed.map((issue) => issue.location.blockIndex)).toEqual([0, 2])
  })

  it("flags image alt failures on hero images and malformed alt on body images", () => {
    const document = healthyDocument()
    const imageIndex = document.body.findIndex((block) => block.type === "image")
    document.body[imageIndex] = { type: "image", src: "/media/map.webp" } as Writable<ContentBlock>
    expect(codesOf(document)).toEqual(["BLOCK_MALFORMED"])

    const hero = healthyDocument()
    hero.hero = { title: "Hero", image: { src: "/media/hero.webp", alt: " " } }
    expect(codesOf(hero)).toEqual(["IMAGE_ALT_MISSING"])
    expect(issuesOf(hero)[0]?.location.field).toBe("hero.image.alt")

    const heroValid = healthyDocument()
    heroValid.hero = { title: "Hero", image: { src: "/media/hero.webp", alt: "Hero art" } }
    expect(codesOf(heroValid)).toEqual([])
  })

  it("flags heading hierarchy violations and duplicates", () => {
    const noHeadings = healthyDocument()
    noHeadings.body = [{ type: "paragraph", text: "x".repeat(MIN_CONTENT_CHARS) }, REFERENCE_BLOCK]
    expect(codesOf(noHeadings)).toContain("HEADING_MISSING")

    const wrongFirst = healthyDocument()
    wrongFirst.body = [
      { type: "heading", level: 3, text: "First section" },
      { type: "paragraph", text: "x".repeat(400) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(wrongFirst)).toContain("HEADING_FIRST_LEVEL_INVALID")

    const skipped = healthyDocument()
    skipped.body = [
      { type: "heading", level: 2, text: "First" },
      { type: "heading", level: 4, text: "Skipped" },
      { type: "paragraph", text: "x".repeat(400) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(skipped)).toContain("HEADING_LEVEL_SKIPPED")

    const descending = healthyDocument()
    descending.body = [
      { type: "heading", level: 4, text: "Deep" },
      { type: "heading", level: 2, text: "Back to top" },
      { type: "paragraph", text: "x".repeat(400) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(descending)).toContain("HEADING_FIRST_LEVEL_INVALID")
    expect(codesOf(descending)).not.toContain("HEADING_LEVEL_SKIPPED")

    const duplicated = healthyDocument()
    duplicated.body = [
      { type: "heading", level: 2, text: "Same Heading" },
      { type: "heading", level: 3, text: "same heading" },
      { type: "paragraph", text: "x".repeat(400) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(duplicated)).toContain("HEADING_DUPLICATED")
  })

  it("enforces the prose length boundary exactly", () => {
    const atBoundary = healthyDocument()
    atBoundary.body = [
      { type: "heading", level: 2, text: "T" },
      { type: "paragraph", text: "x".repeat(MIN_CONTENT_CHARS - 2) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(atBoundary)).toEqual([])

    const belowBoundary = healthyDocument()
    belowBoundary.body = [
      { type: "heading", level: 2, text: "T" },
      { type: "paragraph", text: "x".repeat(MIN_CONTENT_CHARS - 3) },
      REFERENCE_BLOCK,
    ]
    expect(codesOf(belowBoundary)).toEqual(["CONTENT_TOO_SHORT"])
  })
})

describe("deterministic rules: links and citations", () => {
  it("flags unknown internal link targets only when the registry is provided", () => {
    const document = healthyDocument()
    const known = ["/", "/guides"]
    expect(codesOf(document, { knownPathnames: known })).toEqual(["INTERNAL_LINK_UNKNOWN"])
    const issue = issuesOf(document, { knownPathnames: known })[0]
    expect(issue.location.field).toBe("relatedPages[0]")

    expect(codesOf(document, { knownPathnames: ["/", "/guides", "/guides/related"] })).toEqual([])
    expect(codesOf(document)).toEqual([])
  })

  it("flags slug collisions against existing site pathnames", () => {
    const document = healthyDocument()
    expect(codesOf(document, { existingPathnames: ["/guides/article"] })).toEqual([
      "SLUG_COLLISION",
    ])
    expect(codesOf(document, { existingPathnames: ["/other"] })).toEqual([])
  })

  it("flags incomplete citations, unknown references, and unreferenced citations", () => {
    const incomplete = healthyDocument()
    incomplete.citations = [{ id: "citation-prd", title: " ", url: "ftp://site-a.test/prd" }]
    expect(codesOf(incomplete)).toEqual(["CITATION_INCOMPLETE"])

    const unknownReference = healthyDocument()
    unknownReference.body = [
      ...unknownReference.body.filter((block) => block.type !== "references"),
      { type: "references", items: [{ citationId: "citation-ghost", label: "Ghost" }] },
    ]
    expect(codesOf(unknownReference)).toEqual(["CITATION_REFERENCE_UNKNOWN"])

    const unreferenced = healthyDocument()
    unreferenced.body = unreferenced.body.filter((block) => block.type !== "references")
    expect(codesOf(unreferenced)).toEqual(["CITATION_UNREFERENCED"])

    const citationFree = healthyDocument()
    citationFree.citations = undefined
    citationFree.body = citationFree.body.filter((block) => block.type !== "references")
    expect(codesOf(citationFree)).toEqual([])
  })
})

describe("deterministic rules: coverage completions", () => {
  it("treats fully identical issues as equal in comparison", async () => {
    const { compareIssues } = await import("../src/index.js")
    const issue = {
      code: "SAME_CODE",
      location: { field: "same.field" },
      message: "same message",
      recommendation: "same recommendation",
      severity: "minor" as const,
    }
    expect(compareIssues(issue, { ...issue })).toBe(0)
  })

  it("accepts http citations and flags unparseable ones", () => {
    const httpCitation = healthyDocument()
    httpCitation.citations = [
      { id: "citation-prd", title: "Product requirements", url: "http://site-a.test/prd" },
    ]
    expect(codesOf(httpCitation)).toEqual([])

    const unparseable = healthyDocument()
    unparseable.citations = [
      { id: "citation-prd", title: "Product requirements", url: "not a url at all" },
    ]
    expect(codesOf(unparseable)).toEqual(["CITATION_INCOMPLETE"])
  })

  it("skips prose checks but keeps citation rules for tag pages", () => {
    expect(codesOf(tagPageFixture)).toEqual(["CITATION_UNREFERENCED"])
  })

  it("tolerates a missing modifiedAt on an unindexed page", () => {
    const document = healthyDocument()
    document.metadata.modifiedAt = undefined
    document.seo.robots = { index: false, follow: true }
    expect(codesOf(document)).toEqual([])
  })

  it("compares canonical roots without trailing-slash handling", () => {
    const document = clone(redirectPageFixture)
    document.route.pathname = "/"
    document.route.canonicalUrl = "https://site-a.test/"
    document.seo.title = ""
    expect(issuesOf(document).map((issue) => issue.code)).toEqual(["SEO_TITLE_MISSING"])
  })
})

describe("deterministic rules: page-type dispatch", () => {
  it("skips structure and citation rules for redirect pages but keeps seo checks", () => {
    const document = clone(redirectPageFixture)
    document.seo.title = ""
    const issues = issuesOf(document)
    expect(issues.map((issue) => issue.code)).toEqual(["SEO_TITLE_MISSING"])
  })

  it("checks internal links when related pages are absent", () => {
    const document = healthyDocument()
    document.relatedPages = undefined
    expect(codesOf(document, { knownPathnames: ["/", "/guides"] })).toEqual([])
  })

  it("flags a hero image whose alt is missing entirely", () => {
    const document = healthyDocument()
    document.hero = {
      title: "Hero",
      image: { src: "/media/hero.webp" } as NonNullable<Writable<ArticlePage>["hero"]>["image"],
    }
    expect(codesOf(document)).toEqual(["IMAGE_ALT_MISSING"])
  })

  it("checks no internal link candidates for redirect pages even with a registry", () => {
    const document = clone(redirectPageFixture)
    expect(
      issuesOf(document, { knownPathnames: ["/", "/guides"] }).map((issue) => issue.code),
    ).toEqual([])
  })
})

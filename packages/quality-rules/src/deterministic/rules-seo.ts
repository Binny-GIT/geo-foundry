import { StructuredDataSchema, type PageDocument } from "@geo/schema"

import type { QualityIssue } from "./issue.js"

export const SEO_TITLE_MAX_CHARS = 70
export const SEO_DESCRIPTION_MAX_CHARS = 160

const issueOf = (
  code: string,
  severity: QualityIssue["severity"],
  field: string,
  message: string,
  recommendation: string,
): QualityIssue => ({ code, location: { field }, message, recommendation, severity })

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

const normalizedPathnameOf = (value: string): string => {
  try {
    const pathname = new URL(value).pathname
    return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  } catch {
    return value
  }
}

export const seoTitleRules = (document: PageDocument): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  const title = document.seo.title.trim()
  if (title.length === 0) {
    issues.push(
      issueOf(
        "SEO_TITLE_MISSING",
        "major",
        "seo.title",
        "SEO title is empty",
        "Provide a non-empty SEO title",
      ),
    )
  } else if (title.length > SEO_TITLE_MAX_CHARS) {
    issues.push(
      issueOf(
        "SEO_TITLE_TOO_LONG",
        "minor",
        "seo.title",
        `SEO title is ${title.length} characters (max ${SEO_TITLE_MAX_CHARS})`,
        "Shorten the SEO title so search engines do not truncate it",
      ),
    )
  }
  const description = document.seo.description.trim()
  if (description.length === 0) {
    issues.push(
      issueOf(
        "SEO_DESCRIPTION_MISSING",
        "major",
        "seo.description",
        "SEO description is empty",
        "Provide a non-empty meta description",
      ),
    )
  } else if (description.length > SEO_DESCRIPTION_MAX_CHARS) {
    issues.push(
      issueOf(
        "SEO_DESCRIPTION_TOO_LONG",
        "minor",
        "seo.description",
        `SEO description is ${description.length} characters (max ${SEO_DESCRIPTION_MAX_CHARS})`,
        "Shorten the meta description",
      ),
    )
  }
  if (document.metadata.title.trim().length === 0) {
    issues.push(
      issueOf(
        "METADATA_TITLE_MISSING",
        "major",
        "metadata.title",
        "Document title is empty",
        "Provide the document title",
      ),
    )
  }
  return issues
}

export const canonicalRules = (document: PageDocument): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  const canonical = document.route.canonicalUrl
  if (!isHttpUrl(canonical)) {
    issues.push(
      issueOf(
        "CANONICAL_URL_INVALID",
        "major",
        "route.canonicalUrl",
        `Canonical URL is not a valid http(s) URL: ${canonical}`,
        "Set an absolute http(s) canonical URL",
      ),
    )
    return issues
  }
  const canonicalPath = normalizedPathnameOf(canonical)
  const routePath = normalizedPathnameOf(document.route.pathname)
  if (canonicalPath !== routePath) {
    issues.push(
      issueOf(
        "CANONICAL_PATHNAME_MISMATCH",
        "major",
        "route.canonicalUrl",
        `Canonical path ${canonicalPath} does not match route pathname ${routePath}`,
        "Point the canonical URL at the served pathname",
      ),
    )
  }
  return issues
}

export const dateRules = (document: PageDocument): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  const { modifiedAt, publishedAt } = document.metadata
  const publishedMs = publishedAt === undefined ? Number.NaN : Date.parse(publishedAt)
  const modifiedMs = modifiedAt === undefined ? Number.NaN : Date.parse(modifiedAt)
  if (Number.isNaN(publishedMs) || Number.isNaN(modifiedMs)) {
    if (publishedAt !== undefined && Number.isNaN(publishedMs)) {
      issues.push(
        issueOf(
          "DATES_PUBLISHED_INVALID",
          "major",
          "metadata.publishedAt",
          "publishedAt is not a parseable timestamp",
          "Use an ISO-8601 timestamp with offset",
        ),
      )
    }
    if (modifiedAt !== undefined && Number.isNaN(modifiedMs)) {
      issues.push(
        issueOf(
          "DATES_MODIFIED_INVALID",
          "major",
          "metadata.modifiedAt",
          "modifiedAt is not a parseable timestamp",
          "Use an ISO-8601 timestamp with offset",
        ),
      )
    }
  } else if (modifiedMs < publishedMs) {
    issues.push(
      issueOf(
        "DATES_MODIFIED_BEFORE_PUBLISHED",
        "major",
        "metadata.modifiedAt",
        "modifiedAt predates publishedAt",
        "Set modifiedAt to the latest revision time",
      ),
    )
  }
  if (document.seo.robots.index && publishedAt === undefined) {
    issues.push(
      issueOf(
        "SITEMAP_PUBLISHED_MISSING",
        "minor",
        "metadata.publishedAt",
        "Indexable page has no publishedAt for sitemap lastmod",
        "Set publishedAt or mark the page noindex",
      ),
    )
  }
  return issues
}

export const jsonLdRules = (document: PageDocument): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  const entries = document.pageType === "redirect" ? [] : (document.structuredData ?? [])
  entries.forEach((entry, index) => {
    if (!StructuredDataSchema.safeParse(entry).success) {
      issues.push(
        issueOf(
          "JSONLD_SHAPE_INVALID",
          "major",
          `structuredData[${index}]`,
          `Structured data entry ${index} does not match the schema shape`,
          "Regenerate the structured data from the compiler contract",
        ),
      )
    }
  })
  if (document.pageType === "article" && !entries.some((entry) => entry.type === "Article")) {
    issues.push(
      issueOf(
        "JSONLD_ARTICLE_MISSING",
        "major",
        "structuredData",
        "Article page carries no Article structured data",
        "Emit Article JSON-LD for article pages",
      ),
    )
  }
  return issues
}

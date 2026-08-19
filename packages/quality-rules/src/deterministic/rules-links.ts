import type { ArticlePage, PageDocument } from "@geo/schema"

import type { QualityIssue } from "./issue.js"

export type LinkRuleContext = {
  readonly existingPathnames?: readonly string[]
  readonly knownPathnames?: readonly string[]
}

const linkIssue = (
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

export const internalLinkRules = (
  document: PageDocument,
  context: LinkRuleContext,
): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  if (context.knownPathnames !== undefined) {
    const known = new Set(context.knownPathnames)
    const candidates =
      document.pageType === "redirect"
        ? []
        : [
            ...document.breadcrumbs.map((crumb, index) => ({
              field: `breadcrumbs[${index}]`,
              pathname: crumb.pathname,
            })),
            ...(document.relatedPages ?? []).map((page, index) => ({
              field: `relatedPages[${index}]`,
              pathname: page.pathname,
            })),
          ]
    for (const candidate of candidates) {
      if (!known.has(candidate.pathname)) {
        issues.push(
          linkIssue(
            "INTERNAL_LINK_UNKNOWN",
            "major",
            candidate.field,
            `Internal link target ${candidate.pathname} is not a known published pathname`,
            "Link only to published pages on this site",
          ),
        )
      }
    }
  }
  if (
    context.existingPathnames !== undefined &&
    context.existingPathnames.includes(document.route.pathname)
  ) {
    issues.push(
      linkIssue(
        "SLUG_COLLISION",
        "high",
        "route.pathname",
        `Route pathname ${document.route.pathname} already exists on the site`,
        "Choose a unique pathname before publishing",
      ),
    )
  }
  return issues
}

export const citationRules = (document: PageDocument): readonly QualityIssue[] => {
  const issues: QualityIssue[] = []
  if (document.pageType === "redirect") {
    return issues
  }
  const citations = document.citations ?? []
  const hasReferencesBlock = document.body.some((block) => block.type === "references")
  if (citations.length === 0 && !hasReferencesBlock) {
    return issues
  }
  const citationIds = new Set<string>()
  citations.forEach((citation, index) => {
    citationIds.add(citation.id)
    if (citation.title.trim().length === 0 || !isHttpUrl(citation.url)) {
      issues.push(
        linkIssue(
          "CITATION_INCOMPLETE",
          "major",
          `citations[${index}]`,
          `Citation ${index} lacks a title or a valid http(s) URL`,
          "Complete every citation with title and absolute URL",
        ),
      )
    }
  })
  if (hasReferencesBlock) {
    document.body.forEach((block, blockIndex) => {
      if (block.type !== "references") {
        return
      }
      block.items.forEach((item, itemIndex) => {
        if (!citationIds.has(item.citationId)) {
          issues.push(
            linkIssue(
              "CITATION_REFERENCE_UNKNOWN",
              "major",
              `body[${blockIndex}].items[${itemIndex}]`,
              `Reference cites unknown citation id ${item.citationId}`,
              "Only reference citation ids declared on the page",
            ),
          )
        }
      })
    })
  } else {
    issues.push(
      linkIssue(
        "CITATION_UNREFERENCED",
        "minor",
        "citations",
        "Page declares citations but no references block renders them",
        "Render declared citations in a references block",
      ),
    )
  }
  return issues
}

export type ArticleDocument = ArticlePage

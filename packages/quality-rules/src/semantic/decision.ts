import { sortIssues, type QualityIssue } from "../deterministic/issue.js"
import { roundSimilarity } from "./similarity.js"
import { semanticThresholdsSchema, type SemanticThresholds } from "./thresholds.js"

export type SemanticComparison = "cross-domain" | "same-site"
export type SemanticScope = "content" | "title"

export type SemanticMatch = {
  readonly comparison: SemanticComparison
  readonly editionId: number
  readonly inputHash: string
  readonly scope: SemanticScope
  readonly similarity: number
  readonly siteId: number
  readonly title: string | null
}

export type SemanticOutcome = "pass" | "review-required" | "blocked"

export type SemanticDecision = {
  readonly issues: readonly QualityIssue[]
  readonly outcome: SemanticOutcome
  readonly thresholds: SemanticThresholds | null
  readonly topMatches: readonly SemanticMatch[]
}

export type SemanticDecisionInput = {
  readonly matches: readonly SemanticMatch[]
  readonly thresholds: unknown
}

const COMPARISON_ORDER: Readonly<Record<SemanticComparison, number>> = {
  "cross-domain": 0,
  "same-site": 1,
}

const rounded = (match: SemanticMatch): SemanticMatch => ({
  ...match,
  similarity: roundSimilarity(match.similarity),
})

/**
 * Total deterministic order over matches: similarity desc, then comparison,
 * then edition id, then input hash.
 */
export const sortSemanticMatches = (matches: readonly SemanticMatch[]): readonly SemanticMatch[] =>
  [...matches].sort((left, right) => {
    if (left.similarity !== right.similarity) {
      return right.similarity - left.similarity
    }
    const comparisonDelta = COMPARISON_ORDER[left.comparison] - COMPARISON_ORDER[right.comparison]
    if (comparisonDelta !== 0) {
      return comparisonDelta
    }
    if (left.editionId !== right.editionId) {
      return left.editionId - right.editionId
    }
    return left.inputHash < right.inputHash ? -1 : left.inputHash === right.inputHash ? 0 : 1
  })

const issueOf = (
  code: string,
  severity: QualityIssue["severity"],
  message: string,
  recommendation: string,
): QualityIssue => ({ code, location: { field: "semantic" }, message, recommendation, severity })

const invalidThresholdsDecision = (detail: string): SemanticDecision => ({
  issues: [
    issueOf(
      "SEMANTIC_THRESHOLDS_INVALID",
      "critical",
      `semantic thresholds failed validation: ${detail}`,
      "persist a valid threshold snapshot (0 <= review < block <= 1) before evaluating",
    ),
  ],
  outcome: "blocked",
  thresholds: null,
  topMatches: [],
})

const invalidMatchDecision = (match: SemanticMatch): SemanticDecision => ({
  issues: [
    issueOf(
      "SEMANTIC_MATCH_INVALID",
      "critical",
      `similarity ${String(match.similarity)} for edition ${match.editionId} is not a finite value in [-1, 1]`,
      "re-run the embedding query; similarity stores must return measured cosine similarity",
    ),
  ],
  outcome: "blocked",
  thresholds: null,
  topMatches: [],
})

/**
 * Pure gate over measured similarities. Fail-closed by construction: invalid
 * thresholds or an unusable similarity block instead of guessing, and the
 * cross-domain / same-site boundaries come from the persisted Site snapshot,
 * never from ambient configuration.
 */
export const decideSemantic = (input: SemanticDecisionInput): SemanticDecision => {
  const thresholds = semanticThresholdsSchema.safeParse(input.thresholds)
  if (!thresholds.success) {
    return invalidThresholdsDecision(
      thresholds.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    )
  }
  const matches = input.matches.map(rounded)
  for (const match of matches) {
    if (!Number.isFinite(match.similarity) || match.similarity < -1 || match.similarity > 1) {
      return invalidMatchDecision(match)
    }
  }

  const issues: QualityIssue[] = []
  let outcome: SemanticOutcome = "pass"
  const escalate = (next: SemanticOutcome): void => {
    if (next === "blocked" || (next === "review-required" && outcome === "pass")) {
      outcome = next
    }
  }

  for (const match of matches) {
    const crossDomain = match.comparison === "cross-domain"
    if (crossDomain && match.scope === "content") {
      if (match.similarity >= thresholds.data.crossDomainBlock) {
        issues.push(
          issueOf(
            "SEMANTIC_CROSS_DOMAIN_DUPLICATE",
            "critical",
            `cross-domain content similarity ${match.similarity} with edition ${match.editionId} on site ${match.siteId} is at or above the block threshold ${thresholds.data.crossDomainBlock}`,
            "differentiate the edition for each site or drop the duplicate angle",
          ),
        )
        escalate("blocked")
      } else if (match.similarity >= thresholds.data.crossDomainReview) {
        issues.push(
          issueOf(
            "SEMANTIC_CROSS_DOMAIN_REVIEW",
            "major",
            `cross-domain content similarity ${match.similarity} with edition ${match.editionId} on site ${match.siteId} is in the review band [${thresholds.data.crossDomainReview}, ${thresholds.data.crossDomainBlock})`,
            "a reviewer must confirm the editions are genuinely distinct before approval",
          ),
        )
        escalate("review-required")
      }
      continue
    }
    if (!crossDomain && match.scope === "title") {
      if (match.similarity >= thresholds.data.sameSiteTitleBlock) {
        issues.push(
          issueOf(
            "SEMANTIC_SAME_SITE_TITLE_DUPLICATE",
            "high",
            `same-site title similarity ${match.similarity} with edition ${match.editionId} on site ${match.siteId} is at or above the block threshold ${thresholds.data.sameSiteTitleBlock}`,
            "rewrite the title so it is distinct within the site",
          ),
        )
        escalate("blocked")
      }
      continue
    }
    const reviewFloor = thresholds.data.crossDomainReview
    if (match.similarity >= reviewFloor) {
      issues.push(
        issueOf(
          crossDomain
            ? "SEMANTIC_CROSS_DOMAIN_TITLE_SIMILAR"
            : "SEMANTIC_SAME_SITE_CONTENT_SIMILAR",
          "info",
          `${match.comparison} ${match.scope} similarity ${match.similarity} with edition ${match.editionId} on site ${match.siteId} is above ${reviewFloor}`,
          "informational only: this comparison does not gate publication",
        ),
      )
    }
  }

  return {
    issues: sortIssues(issues),
    outcome,
    thresholds: thresholds.data,
    topMatches: sortSemanticMatches(matches),
  }
}

export {
  QUALITY_SEVERITY,
  aggregateSeverities,
  compareIssues,
  isBlockingSeverity,
  serializeIssues,
  sortIssues,
  type QualityIssue,
  type QualityIssueLocation,
  type QualitySeverity,
  type SeverityAggregate,
} from "./deterministic/issue.js"
export {
  deterministicRuleIds,
  runDeterministicRules,
  type DeterministicRuleInput,
  type DeterministicRuleResult,
} from "./deterministic/dispatch.js"
export type { LinkRuleContext } from "./deterministic/rules-links.js"
export { SEO_DESCRIPTION_MAX_CHARS, SEO_TITLE_MAX_CHARS } from "./deterministic/rules-seo.js"
export { MIN_CONTENT_CHARS } from "./deterministic/rules-structure.js"
export {
  decideSemantic,
  sortSemanticMatches,
  type SemanticComparison,
  type SemanticDecision,
  type SemanticDecisionInput,
  type SemanticMatch,
  type SemanticOutcome,
  type SemanticScope,
} from "./semantic/decision.js"
export {
  SemanticSimilarityError,
  SEMANTIC_SIMILARITY_ERROR_CODE,
  cosineSimilarity,
  roundSimilarity,
} from "./semantic/similarity.js"
export {
  CROSS_DOMAIN_BLOCK_THRESHOLD,
  CROSS_DOMAIN_REVIEW_THRESHOLD,
  DEFAULT_SEMANTIC_THRESHOLDS,
  SAME_SITE_TITLE_BLOCK_THRESHOLD,
  semanticThresholdsSchema,
  serializeSemanticThresholds,
  type SemanticThresholds,
} from "./semantic/thresholds.js"

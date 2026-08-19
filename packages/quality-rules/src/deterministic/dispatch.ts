import type { PageDocument } from "@geo/schema"

import {
  aggregateSeverities,
  sortIssues,
  type QualityIssue,
  type SeverityAggregate,
} from "./issue.js"
import type { LinkRuleContext } from "./rules-links.js"
import { citationRules, internalLinkRules } from "./rules-links.js"
import { canonicalRules, dateRules, jsonLdRules, seoTitleRules } from "./rules-seo.js"
import {
  blockRules,
  contentLengthRule,
  headingRules,
  structureInputOf,
  type StructureRuleInput,
} from "./rules-structure.js"

export type DeterministicRuleInput = {
  readonly context?: LinkRuleContext
  readonly document: PageDocument
}

export type DeterministicRuleResult = {
  readonly aggregate: SeverityAggregate
  readonly issues: readonly QualityIssue[]
}

type StructureRule = (input: StructureRuleInput) => readonly QualityIssue[]

const STRUCTURE_RULE_DISPATCH: readonly StructureRule[] = [
  blockRules,
  headingRules,
  contentLengthRule,
]

const DOCUMENT_RULE_DISPATCH: readonly ((document: PageDocument) => readonly QualityIssue[])[] = [
  seoTitleRules,
  canonicalRules,
  dateRules,
  jsonLdRules,
]

export const deterministicRuleIds = [
  "seoTitle",
  "canonical",
  "dates",
  "jsonLd",
  "blocks",
  "headings",
  "contentLength",
  "internalLinks",
  "citations",
] as const

const emptyContext: LinkRuleContext = {}

/**
 * Pure deterministic SEO/GEO and structural evaluation. No network, no LLM,
 * no clock reads: the same input always yields the same issue list, sorted
 * and serialized deterministically.
 */
export const runDeterministicRules = (input: DeterministicRuleInput): DeterministicRuleResult => {
  const document = input.document
  const context = input.context ?? emptyContext
  const structureInput = document.pageType === "redirect" ? undefined : structureInputOf(document)

  const issues: QualityIssue[] = [
    ...DOCUMENT_RULE_DISPATCH.flatMap((rule) => rule(document)),
    ...(structureInput === undefined
      ? []
      : STRUCTURE_RULE_DISPATCH.flatMap((rule) => rule(structureInput))),
    ...internalLinkRules(document, context),
    ...citationRules(document),
  ]
  const sorted = sortIssues(issues)
  return { aggregate: aggregateSeverities(sorted), issues: sorted }
}

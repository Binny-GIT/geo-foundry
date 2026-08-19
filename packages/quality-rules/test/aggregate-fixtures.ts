import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  type DeterministicRuleResult,
  type LlmEvaluationOutput,
  type QualityGateInput,
  type SemanticDecision,
} from "../src/index.js"

export const SHA = "a".repeat(64)

export const cleanDeterministic: DeterministicRuleResult = {
  aggregate: {
    blocking: false,
    counts: { critical: 0, high: 0, info: 0, major: 0, minor: 0 },
  },
  issues: [],
}

export const cleanSemantic: SemanticDecision = {
  issues: [],
  outcome: "pass",
  thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
  topMatches: [],
}

export const cleanLlmOutput: LlmEvaluationOutput = {
  dimensions: { geo: 88, originality: 86, quality: 90, seo: 87, siteFit: 85 },
  issues: [],
  overall: 88,
  recommendations: ["Tighten the opening summary."],
  schemaVersion: 1,
}

export const gateInput = (
  overrides: {
    deterministic?: Partial<QualityGateInput["deterministic"]>
    llm?: Partial<QualityGateInput["llm"]>
    semantic?: Partial<QualityGateInput["semantic"]>
    expectedInputHash?: string
  } = {},
): QualityGateInput => ({
  deterministic: {
    evidenceId: "det-assessment-1",
    inputHash: SHA,
    kind: "deterministic",
    result: cleanDeterministic,
    ...overrides.deterministic,
  },
  expectedInputHash: overrides.expectedInputHash ?? SHA,
  llm: {
    decision: { kind: "passed", state: "passed" },
    evidenceId: "llm-assessment-1",
    inputHash: SHA,
    kind: "llm",
    output: cleanLlmOutput,
    ...overrides.llm,
  },
  semantic: {
    decision: cleanSemantic,
    evidenceId: "semantic-assessment-1",
    inputHash: SHA,
    kind: "semantic",
    ...overrides.semantic,
  },
})

import { sortIssues, type QualityIssue } from "./deterministic/issue.js"
import type { DeterministicRuleResult } from "./deterministic/dispatch.js"
import { classifyLlmEvaluation, type LlmEvaluationDecision } from "./llm/evaluation-gate.js"
import {
  DEFAULT_LLM_GATE_THRESHOLDS,
  type LlmEvaluationOutput,
  type LlmGateThresholds,
} from "./llm/evaluation-contract.js"
import type { SemanticDecision } from "./semantic/decision.js"
import { DEFAULT_SEMANTIC_THRESHOLDS, type SemanticThresholds } from "./semantic/thresholds.js"

export const GATE_REASON = {
  DETERMINISTIC: "GATE_BLOCKED_DETERMINISTIC",
  LLM_ISSUE: "GATE_BLOCKED_LLM_ISSUE",
  LLM_THRESHOLD: "GATE_BLOCKED_LLM_THRESHOLD",
  LLM_THRESHOLDS_INVALID: "GATE_BLOCKED_LLM_THRESHOLDS_INVALID",
  LAYER_ERROR: "GATE_LAYER_ERROR",
  LAYER_MISSING: "GATE_LAYER_MISSING",
  PASSED: "GATE_PASSED",
  SEMANTIC_BLOCKED: "GATE_BLOCKED_SEMANTIC",
  SEMANTIC_REVIEW: "GATE_REVIEW_REQUIRED_SEMANTIC",
  STALE_INPUT: "GATE_BLOCKED_STALE_INPUT",
} as const

export type GateDecision = "blocked" | "passed" | "review-required"

export type LayerError = {
  readonly classification: string
  readonly retryability: "retryable" | "terminal" | undefined
}

type GateLayer = {
  readonly evidenceId: string
  readonly inputHash: string
}

export type DeterministicLayer = GateLayer & {
  readonly kind: "deterministic"
  readonly result: DeterministicRuleResult
}

export type SemanticLayer = GateLayer & {
  readonly decision: SemanticDecision | undefined
  readonly error: LayerError | undefined
  readonly kind: "semantic"
}

export type LlmLayer = GateLayer & {
  readonly decision: LlmEvaluationDecision | undefined
  readonly error: LayerError | undefined
  readonly kind: "llm"
  readonly output: LlmEvaluationOutput | undefined
  readonly thresholds: LlmGateThresholds | undefined
}

export type QualityGateInput = {
  readonly deterministic: DeterministicLayer | undefined
  readonly expectedInputHash: string
  readonly llm: LlmLayer | undefined
  readonly semantic: SemanticLayer | undefined
}

export type QualityGateResponse = {
  readonly dimensions: LlmEvaluationOutput["dimensions"] | null
  readonly issues: readonly QualityIssue[]
  readonly overall: number | null
  readonly recommendations: readonly string[]
}

export type QualityAggregate = {
  readonly assessmentState: "error" | "failed" | "passed"
  readonly decision: GateDecision
  readonly dimensions: LlmEvaluationOutput["dimensions"] | null
  readonly evidence: {
    readonly deterministic: string | null
    readonly llm: string | null
    readonly semantic: string | null
  }
  readonly gate: { readonly reasons: readonly string[] }
  readonly inputHash: string
  readonly issues: readonly QualityIssue[]
  readonly overall: number | null
  readonly recommendations: readonly string[]
  readonly response: QualityGateResponse
  readonly thresholds: {
    readonly llm: LlmGateThresholds
    readonly semantic: SemanticThresholds
  }
}

const llmIssueOf = (issue: LlmEvaluationOutput["issues"][number]): QualityIssue => ({
  code: issue.code,
  location: { field: "llm" },
  message: issue.message,
  recommendation: issue.recommendation ?? "no recommendation supplied by the evaluator",
  severity: issue.severity,
})

/**
 * Pure three-layer publication gate. Fail-closed by construction: a missing
 * or errored layer, a stale input hash, blocking deterministic issues, an
 * LLM score below the persisted Site snapshot, or a semantic block/review
 * band each contribute stable reason codes, and the caller receives the PRD
 * `/evaluate` response shape with the gate decision and evidence ids.
 */
export const aggregateQualityGate = (input: QualityGateInput): QualityAggregate => {
  const reasons: string[] = []
  let errored = false
  const evidenceOf = (layer: GateLayer | undefined): string | null =>
    layer === undefined ? null : layer.evidenceId

  if (
    input.deterministic === undefined ||
    input.llm === undefined ||
    input.semantic === undefined
  ) {
    reasons.push(GATE_REASON.LAYER_MISSING)
    errored = true
  }
  const llmFailed =
    input.llm !== undefined && (input.llm.error !== undefined || input.llm.output === undefined)
  const semanticFailed =
    input.semantic !== undefined &&
    (input.semantic.error !== undefined || input.semantic.decision === undefined)
  if (llmFailed || semanticFailed) {
    reasons.push(GATE_REASON.LAYER_ERROR)
    errored = true
  }
  for (const layer of [input.deterministic, input.llm, input.semantic]) {
    if (layer !== undefined && layer.inputHash !== input.expectedInputHash) {
      reasons.push(GATE_REASON.STALE_INPUT)
      errored = true
      break
    }
  }

  const deterministicIssues = input.deterministic?.result.issues ?? []
  if (input.deterministic?.result.aggregate.blocking === true) {
    reasons.push(GATE_REASON.DETERMINISTIC)
  }

  const llmOutput = input.llm?.output
  const llmThresholds = input.llm?.thresholds ?? DEFAULT_LLM_GATE_THRESHOLDS
  const llmDecision =
    llmOutput === undefined ? undefined : classifyLlmEvaluation(llmOutput, llmThresholds)
  const llmIssues = llmOutput?.issues.map(llmIssueOf) ?? []
  if (llmDecision?.kind === "failed") {
    reasons.push(
      llmDecision.reason === "LLM_GATE_BLOCKING_ISSUE"
        ? GATE_REASON.LLM_ISSUE
        : llmDecision.reason === "LLM_GATE_THRESHOLDS_INVALID"
          ? GATE_REASON.LLM_THRESHOLDS_INVALID
          : GATE_REASON.LLM_THRESHOLD,
    )
  }

  const semanticDecision = input.semantic?.decision
  const semanticIssues = semanticDecision?.issues ?? []
  if (semanticDecision?.outcome === "blocked") {
    reasons.push(GATE_REASON.SEMANTIC_BLOCKED)
  } else if (semanticDecision?.outcome === "review-required") {
    reasons.push(GATE_REASON.SEMANTIC_REVIEW)
  }

  const decision: GateDecision = reasons.some((reason) => reason.startsWith("GATE_BLOCKED"))
    ? "blocked"
    : reasons.includes(GATE_REASON.SEMANTIC_REVIEW)
      ? "review-required"
      : errored
        ? "blocked"
        : "passed"

  if (decision === "passed") {
    reasons.push(GATE_REASON.PASSED)
  }

  const issues = sortIssues([...deterministicIssues, ...llmIssues, ...semanticIssues])
  const overall = llmOutput?.overall ?? null
  const dimensions = llmOutput === null || llmOutput === undefined ? null : llmOutput.dimensions
  const recommendations = llmOutput?.recommendations ?? []
  const assessmentState = errored ? "error" : decision === "passed" ? "passed" : "failed"

  return {
    assessmentState,
    decision: errored && decision !== "blocked" ? "blocked" : decision,
    dimensions,
    evidence: {
      deterministic: evidenceOf(input.deterministic),
      llm: evidenceOf(input.llm),
      semantic: evidenceOf(input.semantic),
    },
    gate: { reasons },
    inputHash: input.expectedInputHash,
    issues,
    overall,
    recommendations,
    response: { dimensions, issues, overall, recommendations },
    thresholds: {
      llm: llmThresholds,
      semantic: semanticDecision?.thresholds ?? DEFAULT_SEMANTIC_THRESHOLDS,
    },
  }
}

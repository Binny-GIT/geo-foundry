import { isBlockingSeverity } from "../deterministic/issue.js"
import {
  DEFAULT_LLM_GATE_THRESHOLDS,
  EVALUATION_DIMENSIONS,
  llmGateThresholdsSchema,
  type EvaluationDimension,
  type LlmEvaluationOutput,
  type LlmGateThresholds,
} from "./evaluation-contract.js"

export type LlmEvaluationFailed = {
  readonly dimension?: EvaluationDimension | "overall"
  readonly issueCodes?: readonly string[]
  readonly kind: "failed"
  readonly reason:
    | "LLM_GATE_BLOCKING_ISSUE"
    | "LLM_GATE_DIMENSION_BELOW_THRESHOLD"
    | "LLM_GATE_OVERALL_BELOW_THRESHOLD"
    | "LLM_GATE_THRESHOLDS_INVALID"
  readonly score?: number
  readonly state: "failed"
  readonly threshold?: number
}

export type LlmEvaluationDecision =
  | { readonly kind: "passed"; readonly state: "passed" }
  | LlmEvaluationFailed

/**
 * Fail-closed gate over a parsed evaluation output. Blocking issues always
 * win over scores, thresholds come from the persisted Site snapshot, and an
 * invalid threshold snapshot fails instead of guessing a pass.
 */
export const classifyLlmEvaluation = (
  output: LlmEvaluationOutput,
  thresholds: LlmGateThresholds = DEFAULT_LLM_GATE_THRESHOLDS,
): LlmEvaluationDecision => {
  const validated = llmGateThresholdsSchema.safeParse(thresholds)
  if (!validated.success) {
    return { kind: "failed", reason: "LLM_GATE_THRESHOLDS_INVALID", state: "failed" }
  }
  const blocking = output.issues.filter((issue) => isBlockingSeverity(issue.severity))
  if (blocking.length > 0) {
    return {
      issueCodes: blocking.map((issue) => issue.code),
      kind: "failed",
      reason: "LLM_GATE_BLOCKING_ISSUE",
      state: "failed",
    }
  }
  if (output.overall < validated.data.overallMin) {
    return {
      dimension: "overall",
      kind: "failed",
      reason: "LLM_GATE_OVERALL_BELOW_THRESHOLD",
      score: output.overall,
      state: "failed",
      threshold: validated.data.overallMin,
    }
  }
  for (const dimension of EVALUATION_DIMENSIONS) {
    const score = output.dimensions[dimension]
    if (score < validated.data.dimensionMin) {
      return {
        dimension,
        kind: "failed",
        reason: "LLM_GATE_DIMENSION_BELOW_THRESHOLD",
        score,
        state: "failed",
        threshold: validated.data.dimensionMin,
      }
    }
  }
  return { kind: "passed", state: "passed" }
}

/**
 * Deterministic redaction marker for evidence and logs: article bodies and
 * other sensitive text are replaced by a length-bearing tag so audits can
 * still prove which input produced a hash without retaining the text.
 */
export const redactEvaluationText = (text: string): string => `<redacted:${text.length}>`

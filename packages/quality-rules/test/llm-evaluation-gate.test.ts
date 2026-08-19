import { describe, expect, it } from "vitest"

import {
  classifyLlmEvaluation,
  redactEvaluationText,
  type LlmEvaluationOutput,
} from "../src/index.js"

const output = (overrides: Partial<LlmEvaluationOutput> = {}): LlmEvaluationOutput => ({
  dimensions: { geo: 88, originality: 86, quality: 90, seo: 87, siteFit: 85 },
  issues: [],
  overall: 88,
  recommendations: [],
  schemaVersion: 1,
  ...overrides,
})

describe("classifyLlmEvaluation", () => {
  it("passes when overall and every dimension clear the defaults with no blocking issue", () => {
    const decision = classifyLlmEvaluation(output())
    expect(decision).toEqual({ kind: "passed", state: "passed" })
  })

  it("passes at the exact boundary overall 80 and dimension 75", () => {
    const decision = classifyLlmEvaluation(
      output({
        dimensions: { geo: 75, originality: 75, quality: 75, seo: 75, siteFit: 75 },
        overall: 80,
      }),
    )
    expect(decision.kind).toBe("passed")
  })

  it("fails on overall 79", () => {
    const decision = classifyLlmEvaluation(output({ overall: 79 }))
    expect(decision).toEqual({
      dimension: "overall",
      kind: "failed",
      reason: "LLM_GATE_OVERALL_BELOW_THRESHOLD",
      score: 79,
      state: "failed",
      threshold: 80,
    })
  })

  it("fails on a single dimension at 74", () => {
    const decision = classifyLlmEvaluation(
      output({ dimensions: { geo: 88, originality: 86, quality: 74, seo: 87, siteFit: 85 } }),
    )
    expect(decision.kind).toBe("failed")
    if (decision.kind === "failed") {
      expect(decision.dimension).toBe("quality")
      expect(decision.reason).toBe("LLM_GATE_DIMENSION_BELOW_THRESHOLD")
    }
  })

  it("fails closed on any blocking issue even with perfect scores", () => {
    const decision = classifyLlmEvaluation(
      output({
        dimensions: { geo: 99, originality: 99, quality: 99, seo: 99, siteFit: 99 },
        issues: [
          {
            code: "UNSUPPORTED_CLAIM",
            message: "The growth statistic has no citation",
            recommendation: "Cite the source or remove the claim",
            severity: "critical",
          },
        ],
        overall: 99,
      }),
    )
    expect(decision.kind).toBe("failed")
    if (decision.kind === "failed") {
      expect(decision.reason).toBe("LLM_GATE_BLOCKING_ISSUE")
      expect(decision.issueCodes).toEqual(["UNSUPPORTED_CLAIM"])
    }
  })

  it("fails on a high severity issue, not only critical", () => {
    const decision = classifyLlmEvaluation(
      output({
        issues: [{ code: "RISKY_PROMISE", message: "Guarantees an outcome", severity: "high" }],
      }),
    )
    expect(decision.kind).toBe("failed")
  })

  it("does not fail on non-blocking severities", () => {
    const decision = classifyLlmEvaluation(
      output({
        issues: [{ code: "TITLE_TOO_GENERIC", message: "vague", severity: "minor" }],
      }),
    )
    expect(decision.kind).toBe("passed")
  })

  it("applies a persisted custom threshold snapshot", () => {
    const decision = classifyLlmEvaluation(output({ overall: 85 }), {
      dimensionMin: 75,
      overallMin: 86,
    })
    expect(decision.kind).toBe("failed")
  })

  it("fails closed on invalid thresholds", () => {
    const decision = classifyLlmEvaluation(output(), { dimensionMin: 101, overallMin: 80 })
    expect(decision.kind).toBe("failed")
    if (decision.kind === "failed") {
      expect(decision.reason).toBe("LLM_GATE_THRESHOLDS_INVALID")
    }
  })
})

describe("redactEvaluationText", () => {
  it("replaces sensitive text with a deterministic marker that keeps length", () => {
    const secret = "x".repeat(120)
    const redacted = redactEvaluationText(secret)
    expect(redacted).toBe("<redacted:120>")
    expect(redactEvaluationText(secret)).toBe(redacted)
    expect(redacted).not.toContain("x")
  })

  it("keeps empty strings empty", () => {
    expect(redactEvaluationText("")).toBe("<redacted:0>")
  })
})

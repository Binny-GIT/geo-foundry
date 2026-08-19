import { describe, expect, it } from "vitest"

import { aggregateQualityGate, type QualityGateInput } from "../src/index.js"
import { cleanLlmOutput, cleanSemantic, gateInput, SHA } from "./aggregate-fixtures.js"

describe("quality gate decisions", () => {
  it("blocks on an LLM overall score of 79", () => {
    const aggregate = aggregateQualityGate(
      gateInput({ llm: { output: { ...cleanLlmOutput, overall: 79 } } }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_LLM_THRESHOLD")
    expect(aggregate.assessmentState).toBe("failed")
  })

  it("blocks on a single dimension at 74", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: {
          output: {
            ...cleanLlmOutput,
            dimensions: { ...cleanLlmOutput.dimensions, quality: 74 },
          },
        },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_LLM_THRESHOLD")
  })

  it("blocks on a blocking deterministic issue even with clean scores", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        deterministic: {
          result: {
            aggregate: {
              blocking: true,
              counts: { critical: 0, high: 1, info: 0, major: 0, minor: 0 },
            },
            issues: [
              {
                code: "SEO_CANONICAL_MISSING",
                location: { field: "metadata.canonical" },
                message: "canonical URL is missing",
                recommendation: "set the canonical URL",
                severity: "high",
              },
            ],
          },
        },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_DETERMINISTIC")
    expect(aggregate.issues[0]?.code).toBe("SEO_CANONICAL_MISSING")
  })

  it("blocks when the semantic layer blocks", () => {
    const aggregate = aggregateQualityGate(
      gateInput({ semantic: { decision: { ...cleanSemantic, outcome: "blocked" } } }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_SEMANTIC")
  })

  it("requires review when only the semantic review band triggers", () => {
    const aggregate = aggregateQualityGate(
      gateInput({ semantic: { decision: { ...cleanSemantic, outcome: "review-required" } } }),
    )
    expect(aggregate.decision).toBe("review-required")
    expect(aggregate.gate.reasons).toContain("GATE_REVIEW_REQUIRED_SEMANTIC")
    expect(aggregate.assessmentState).toBe("failed")
  })

  it("blocks with assessment error when the LLM layer errored", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: {
          decision: undefined,
          error: { classification: "PROVIDER_TIMEOUT", retryability: "retryable" },
          output: undefined,
        },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_LAYER_ERROR")
    expect(aggregate.assessmentState).toBe("error")
    expect(aggregate.overall).toBeNull()
    expect(aggregate.dimensions).toBeNull()
    expect(aggregate.response.overall).toBeNull()
  })

  it("blocks when any layer is missing", () => {
    for (const layer of ["deterministic", "llm", "semantic"] as const) {
      const input = gateInput() as unknown as Record<string, unknown>
      delete input[layer]
      const aggregate = aggregateQualityGate(input as unknown as QualityGateInput)
      expect(aggregate.decision).toBe("blocked")
      expect(aggregate.gate.reasons).toContain("GATE_LAYER_MISSING")
      expect(aggregate.assessmentState).toBe("error")
    }
  })

  it("blocks on a stale layer input hash", () => {
    const aggregate = aggregateQualityGate(gateInput({ expectedInputHash: "b".repeat(64) }))
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_STALE_INPUT")
    expect(aggregate.assessmentState).toBe("error")
    expect(aggregate.inputHash).toBe("b".repeat(64))
  })

  it("prefers blocked over review when both apply", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: { output: { ...cleanLlmOutput, overall: 79 } },
        semantic: { decision: { ...cleanSemantic, outcome: "review-required" } },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toEqual([
      "GATE_BLOCKED_LLM_THRESHOLD",
      "GATE_REVIEW_REQUIRED_SEMANTIC",
    ])
  })

  it("reports an LLM threshold snapshot override in the aggregate", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: {
          decision: { kind: "passed", state: "passed" },
          thresholds: { dimensionMin: 70, overallMin: 70 },
        },
      }),
    )
    expect(aggregate.thresholds.llm).toEqual({ dimensionMin: 70, overallMin: 70 })
  })

  it("blocks with a stable reason when the LLM threshold snapshot is invalid", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: {
          decision: { kind: "passed", state: "passed" },
          thresholds: { dimensionMin: 101, overallMin: 80 },
        },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_LLM_THRESHOLDS_INVALID")
    expect(aggregate.assessmentState).toBe("failed")
  })

  it("blocks with a blocking LLM issue reason distinct from thresholds", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        llm: {
          decision: { kind: "failed", state: "failed" },
          output: {
            ...cleanLlmOutput,
            issues: [{ code: "UNSUPPORTED_CLAIM", message: "no citation", severity: "critical" }],
          },
        },
      }),
    )
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toContain("GATE_BLOCKED_LLM_ISSUE")
  })

  it("forces blocked when a layer is missing even if only review would apply", () => {
    const input = gateInput({
      semantic: { decision: { ...cleanSemantic, outcome: "review-required" } },
    }) as unknown as Record<string, unknown>
    delete input.llm
    const aggregate = aggregateQualityGate(input as unknown as QualityGateInput)
    expect(aggregate.decision).toBe("blocked")
    expect(aggregate.gate.reasons).toEqual(["GATE_LAYER_MISSING", "GATE_REVIEW_REQUIRED_SEMANTIC"])
    expect(aggregate.assessmentState).toBe("error")
  })

  it("hashes the aggregate against the expected edition input hash", () => {
    expect(aggregateQualityGate(gateInput()).inputHash).toBe(SHA)
  })
})

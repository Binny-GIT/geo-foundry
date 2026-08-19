import { describe, expect, it } from "vitest"

import {
  aggregateQualityGate,
  DEFAULT_LLM_GATE_THRESHOLDS,
  DEFAULT_SEMANTIC_THRESHOLDS,
} from "../src/index.js"
import { cleanLlmOutput, cleanSemantic, gateInput, SHA } from "./aggregate-fixtures.js"

describe("quality gate response shape", () => {
  it("passes with the PRD response shape, evidence ids, and thresholds", () => {
    expect(aggregateQualityGate(gateInput())).toEqual({
      assessmentState: "passed",
      decision: "passed",
      dimensions: cleanLlmOutput.dimensions,
      evidence: {
        deterministic: "det-assessment-1",
        llm: "llm-assessment-1",
        semantic: "semantic-assessment-1",
      },
      gate: { reasons: ["GATE_PASSED"] },
      inputHash: SHA,
      issues: [],
      overall: 88,
      recommendations: ["Tighten the opening summary."],
      response: {
        dimensions: cleanLlmOutput.dimensions,
        issues: [],
        overall: 88,
        recommendations: ["Tighten the opening summary."],
      },
      thresholds: {
        llm: DEFAULT_LLM_GATE_THRESHOLDS,
        semantic: DEFAULT_SEMANTIC_THRESHOLDS,
      },
    })
  })

  it("merges issues from all layers in deterministic severity order", () => {
    const aggregate = aggregateQualityGate(
      gateInput({
        deterministic: {
          result: {
            aggregate: {
              blocking: false,
              counts: { critical: 0, high: 0, info: 0, major: 0, minor: 1 },
            },
            issues: [
              {
                code: "A_MINOR_RULE",
                location: { field: "body" },
                message: "minor deterministic",
                recommendation: "fix",
                severity: "minor",
              },
            ],
          },
        },
        llm: {
          output: {
            ...cleanLlmOutput,
            issues: [{ code: "LLM_TITLE_GENERIC", message: "title is generic", severity: "major" }],
          },
        },
        semantic: {
          decision: {
            ...cleanSemantic,
            issues: [
              {
                code: "SEMANTIC_INFO",
                location: { field: "semantic" },
                message: "informational similarity",
                recommendation: "none",
                severity: "info",
              },
            ],
          },
        },
      }),
    )
    expect(aggregate.issues.map((issue) => issue.code)).toEqual([
      "LLM_TITLE_GENERIC",
      "A_MINOR_RULE",
      "SEMANTIC_INFO",
    ])
    expect(aggregate.response.issues).toEqual(aggregate.issues)
  })

  it("produces byte-identical output for repeated calls", () => {
    const input = gateInput({
      semantic: { decision: { ...cleanSemantic, outcome: "review-required" } },
    })
    expect(JSON.stringify(aggregateQualityGate(input))).toBe(
      JSON.stringify(aggregateQualityGate(input)),
    )
  })
})

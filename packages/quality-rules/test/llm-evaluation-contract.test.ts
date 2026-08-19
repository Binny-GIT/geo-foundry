import { describe, expect, it } from "vitest"

import {
  DEFAULT_LLM_GATE_THRESHOLDS,
  EVALUATION_DIMENSIONS,
  EVALUATION_OUTPUT_SCHEMA_VERSION,
  llmEvaluationOutputSchema,
  parseLlmEvaluationOutput,
  serializeLlmGateThresholds,
} from "../src/index.js"

const goldenOutput = {
  dimensions: { geo: 88, originality: 86, quality: 90, seo: 87, siteFit: 85 },
  issues: [
    {
      code: "TITLE_TOO_GENERIC",
      message: "Title could name the concrete outcome",
      recommendation: "Name the measured outcome in the title",
      severity: "minor",
    },
  ],
  overall: 88,
  recommendations: ["Tighten the opening summary."],
  schemaVersion: 1,
}

describe("llm evaluation output contract", () => {
  it("parses the golden fixture deterministically", () => {
    const first = parseLlmEvaluationOutput(goldenOutput)
    const second = parseLlmEvaluationOutput(JSON.parse(JSON.stringify(goldenOutput)))
    expect(first.kind).toBe("parsed")
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it("requires exactly the five contract dimensions", () => {
    expect([...EVALUATION_DIMENSIONS].sort()).toEqual([
      "geo",
      "originality",
      "quality",
      "seo",
      "siteFit",
    ])
    const missing = parseLlmEvaluationOutput({
      ...goldenOutput,
      dimensions: { geo: 88, originality: 86, quality: 90, seo: 87 },
    })
    expect(missing.kind).toBe("invalid")
  })

  it("rejects scores outside 0-100", () => {
    for (const overall of [-1, 101, Number.NaN]) {
      expect(parseLlmEvaluationOutput({ ...goldenOutput, overall }).kind).toBe("invalid")
    }
    expect(
      parseLlmEvaluationOutput({
        ...goldenOutput,
        dimensions: { ...goldenOutput.dimensions, seo: 101 },
      }).kind,
    ).toBe("invalid")
  })

  it("rejects unknown severities and issue shapes", () => {
    expect(
      parseLlmEvaluationOutput({
        ...goldenOutput,
        issues: [{ ...goldenOutput.issues[0], severity: "catastrophic" }],
      }).kind,
    ).toBe("invalid")
    expect(parseLlmEvaluationOutput({ ...goldenOutput, issues: [{ code: "X" }] }).kind).toBe(
      "invalid",
    )
  })

  it("rejects unsupported schema versions and unknown root fields", () => {
    expect(parseLlmEvaluationOutput({ ...goldenOutput, schemaVersion: 2 }).kind).toBe("invalid")
    expect(parseLlmEvaluationOutput({ ...goldenOutput, schemaVersion: 0 }).kind).toBe("invalid")
    expect(parseLlmEvaluationOutput({ ...goldenOutput, extra: true }).kind).toBe("invalid")
  })

  it("exposes the schema itself for provider-side validation", () => {
    expect(llmEvaluationOutputSchema.safeParse(goldenOutput).success).toBe(true)
    expect(EVALUATION_OUTPUT_SCHEMA_VERSION).toBe(1)
  })
})

describe("llm gate thresholds", () => {
  it("defaults to the PRD values", () => {
    expect(DEFAULT_LLM_GATE_THRESHOLDS).toEqual({ dimensionMin: 75, overallMin: 80 })
  })

  it("serializes canonically for hashing at the caller", () => {
    expect(serializeLlmGateThresholds(DEFAULT_LLM_GATE_THRESHOLDS)).toBe(
      '{"dimensionMin":75,"overallMin":80}',
    )
  })
})

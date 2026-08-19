import { describe, expect, it } from "vitest"

import {
  DEFAULT_LLM_GATE_THRESHOLDS,
  type LlmEvaluationOutput,
  type LlmGateThresholds,
} from "@geo/quality-rules"

import {
  evaluationInputHash,
  llmThresholdsHash,
  runLlmEvaluation,
  toAssessmentRequest,
  toRedactedEvidence,
  type LlmEvaluationRecord,
} from "../../src/evaluation/llm-evaluation.js"
import { createFakeProvider } from "../../src/providers/fake.js"
import { ProviderError } from "../../src/providers/errors.js"
import {
  CHAT_FIXTURES,
  QUALITY_EVALUATION_PROMPT_VERSION,
  qualityEvaluationFixture,
} from "../../src/providers/fixtures.js"
import type { LLMProvider } from "../../src/providers/types.js"

const input = {
  body: [
    { blockType: "heading", level: "2", text: "Release gates" },
    { blockType: "paragraph", text: "Every release passes a deterministic gate." },
  ],
  requestId: "req-evaluation-1",
  siteAngle: "practitioner-playbook",
  siteName: "Site A",
  summary: "How deterministic gates protect releases.",
  title: "Deterministic release gates",
}

const failingOutput: LlmEvaluationOutput = {
  dimensions: { geo: 88, originality: 86, quality: 74, seo: 87, siteFit: 85 },
  issues: [],
  overall: 88,
  recommendations: [],
  schemaVersion: 1,
}

const providerReturning = (output: unknown): LLMProvider => ({
  ...createFakeProvider(),
  async generate() {
    return {
      content: output as never,
      latencyMs: 12,
      modelId: "fake-chat-v1",
      providerId: "fake",
      rawResponseHash: "c".repeat(64),
    }
  },
})

describe("runLlmEvaluation", () => {
  it("scores the golden fake fixture as passed with full persistence evidence", async () => {
    const record = await runLlmEvaluation({ provider: createFakeProvider() }, input)
    expect(record.kind).toBe("scored")
    if (record.kind !== "scored") {
      return
    }
    expect(record.promptVersion).toBe(QUALITY_EVALUATION_PROMPT_VERSION)
    expect(record.providerId).toBe("fake")
    expect(record.modelId).toBe("fake-chat-v1")
    expect(record.rawResponseHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.inputHash).toBe(evaluationInputHash(input))
    expect(record.thresholdsHash).toBe(llmThresholdsHash(DEFAULT_LLM_GATE_THRESHOLDS))
    expect(record.decision.kind).toBe("passed")
    expect(record.output).toEqual(CHAT_FIXTURES[QUALITY_EVALUATION_PROMPT_VERSION])
    expect(record.classification).toBe("passed")
  })

  it("fails closed on a dimension below the threshold", async () => {
    const record = await runLlmEvaluation({ provider: providerReturning(failingOutput) }, input)
    expect(record.kind).toBe("scored")
    if (record.kind === "scored") {
      expect(record.decision.kind).toBe("failed")
      expect(record.classification).toBe("failed")
    }
  })

  it("fails closed on a critical unsupported-claim issue", async () => {
    const output: LlmEvaluationOutput = {
      dimensions: { geo: 99, originality: 99, quality: 99, seo: 99, siteFit: 99 },
      issues: [
        {
          code: "UNSUPPORTED_CLAIM",
          message: "Statistic lacks a citation",
          severity: "critical",
        },
      ],
      overall: 99,
      recommendations: [],
      schemaVersion: 1,
    }
    const record = await runLlmEvaluation({ provider: providerReturning(output) }, input)
    expect(record.kind).toBe("scored")
    if (record.kind === "scored") {
      expect(record.decision).toEqual({
        issueCodes: ["UNSUPPORTED_CLAIM"],
        kind: "failed",
        reason: "LLM_GATE_BLOCKING_ISSUE",
        state: "failed",
      })
    }
  })

  it("maps provider timeouts to a retryable error record", async () => {
    const provider: LLMProvider = {
      ...createFakeProvider(),
      generate() {
        throw new ProviderError("PROVIDER_TIMEOUT", "retryable", "deadline exceeded")
      },
    }
    const record = await runLlmEvaluation({ provider }, input)
    expect(record.kind).toBe("error")
    if (record.kind === "error") {
      expect(record.classification).toBe("PROVIDER_TIMEOUT")
      expect(record.retryability).toBe("retryable")
      expect(record.inputHash).toBe(evaluationInputHash(input))
    }
  })

  it("maps malformed output to a terminal error with parse issues", async () => {
    const record = await runLlmEvaluation(
      { provider: providerReturning({ overall: 9000, schemaVersion: 2 }) },
      input,
    )
    expect(record.kind).toBe("error")
    if (record.kind === "error") {
      expect(record.classification).toBe("PROVIDER_MALFORMED_RESPONSE")
      expect(record.retryability).toBe("terminal")
      expect(record.parseIssues.length).toBeGreaterThan(0)
    }
  })

  it("carries a missing fake fixture as an error, never a pass", async () => {
    const record = await runLlmEvaluation(
      { provider: createFakeProvider({ chatFixtures: {} }) },
      input,
    )
    expect(record.kind).toBe("error")
    if (record.kind === "error") {
      expect(record.classification).toBe("FAKE_FIXTURE_MISSING")
    }
  })

  it("applies a custom persisted threshold snapshot", async () => {
    const thresholds: LlmGateThresholds = { dimensionMin: 75, overallMin: 90 }
    const record = await runLlmEvaluation(
      { provider: createFakeProvider() },
      { ...input, thresholds },
    )
    expect(record.kind).toBe("scored")
    if (record.kind === "scored") {
      expect(record.decision.kind).toBe("failed")
      expect(record.thresholdsHash).toBe(llmThresholdsHash(thresholds))
    }
  })
})

describe("toAssessmentRequest", () => {
  it("maps a scored record onto the CMS assessment contract", async () => {
    const record = await runLlmEvaluation({ provider: createFakeProvider() }, input)
    expect(toAssessmentRequest(record)).toEqual({
      dimensions: qualityEvaluationFixture.dimensions,
      inputHash: evaluationInputHash(input),
      issues: [{ code: "TITLE_TOO_GENERIC", severity: "minor" }],
      modelId: "fake-chat-v1",
      overall: 88,
      promptVersion: QUALITY_EVALUATION_PROMPT_VERSION,
      provider: "fake",
      state: "passed",
      thresholdsHash: llmThresholdsHash(DEFAULT_LLM_GATE_THRESHOLDS),
    })
  })

  it("maps an error record to an error assessment without scores", async () => {
    const provider: LLMProvider = {
      ...createFakeProvider(),
      generate() {
        throw new ProviderError("PROVIDER_SERVER_ERROR", "retryable", "boom")
      },
    }
    const record: LlmEvaluationRecord = await runLlmEvaluation({ provider }, input)
    expect(toAssessmentRequest(record)).toEqual({
      inputHash: evaluationInputHash(input),
      issues: [],
      modelId: "unknown",
      promptVersion: QUALITY_EVALUATION_PROMPT_VERSION,
      provider: "unknown",
      state: "error",
      thresholdsHash: llmThresholdsHash(DEFAULT_LLM_GATE_THRESHOLDS),
    })
  })
})

describe("toRedactedEvidence", () => {
  it("redacts article text while retaining every hash", async () => {
    const record = await runLlmEvaluation({ provider: createFakeProvider() }, input)
    const evidence = toRedactedEvidence(record, input)
    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain(input.title)
    expect(serialized).not.toContain(input.summary)
    expect(serialized).not.toContain("Every release passes")
    expect(evidence).toMatchObject({
      inputHash: evaluationInputHash(input),
      kind: "scored",
      state: "passed",
      title: `<redacted:${input.title.length}>`,
      summary: `<redacted:${input.summary.length}>`,
    })
  })

  it("keeps error detail for an error record without body text", async () => {
    const provider: LLMProvider = {
      ...createFakeProvider(),
      generate() {
        throw new ProviderError("PROVIDER_RATE_LIMITED", "retryable", "slow down")
      },
    }
    const record = await runLlmEvaluation({ provider }, input)
    const evidence = toRedactedEvidence(record, input)
    expect(evidence).toMatchObject({ detail: "slow down", kind: "error", state: "error" })
    expect(JSON.stringify(evidence)).not.toContain(input.title)
  })
})

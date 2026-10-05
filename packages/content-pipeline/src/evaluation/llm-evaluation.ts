import { createHash } from "node:crypto"

import type { RecordAssessmentRequest } from "@geo/content-client"
import {
  classifyLlmEvaluation,
  DEFAULT_LLM_GATE_THRESHOLDS,
  type LlmEvaluationOutput,
  type LlmGateThresholds,
  llmEvaluationOutputSchema,
  llmGateThresholdsSchema,
  parseLlmEvaluationOutput,
  redactEvaluationText,
  serializeLlmGateThresholds,
} from "@geo/quality-rules"

import { ProviderError } from "../providers/errors.js"
import { QUALITY_EVALUATION_PROMPT_VERSION } from "../providers/fixtures.js"
import type { LLMProvider, StructuredChatRequest } from "../providers/types.js"

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex")

export const EVALUATION_MAX_OUTPUT_TOKENS = 4096

export type EvaluationInput = {
  readonly body: readonly unknown[]
  readonly requestId: string
  readonly siteAngle: string
  readonly siteName: string
  readonly summary: string
  readonly thresholds?: LlmGateThresholds
  readonly title: string
}

export type EvaluationDeps = {
  readonly provider: LLMProvider
}

export type LlmEvaluationRecord =
  | {
      readonly classification: "passed" | "failed"
      readonly decision: ReturnType<typeof classifyLlmEvaluation>
      readonly inputHash: string
      readonly latencyMs: number
      readonly modelId: string
      readonly output: LlmEvaluationOutput
      readonly promptVersion: string
      readonly providerId: string
      readonly rawResponseHash: string
      readonly thresholdsHash: string
      readonly kind: "scored"
    }
  | {
      readonly classification: string
      readonly detail: string
      readonly inputHash: string
      readonly kind: "error"
      readonly parseIssues: readonly string[]
      readonly promptVersion: string
      readonly retryability: "retryable" | "terminal" | undefined
      readonly thresholdsHash: string
    }

export const evaluationInputHash = (input: {
  readonly body: readonly unknown[]
  readonly summary: string
  readonly title: string
}): string =>
  sha256(
    JSON.stringify({
      body: input.body,
      summary: input.summary,
      title: input.title,
    }),
  )

export const llmThresholdsHash = (thresholds: LlmGateThresholds): string =>
  sha256(serializeLlmGateThresholds(thresholds))

const buildEvaluationRequest = (
  input: EvaluationInput,
  promptVersion: string,
): StructuredChatRequest<LlmEvaluationOutput> => ({
  maxOutputTokens: EVALUATION_MAX_OUTPUT_TOKENS,
  promptVersion,
  requestId: input.requestId,
  schema: llmEvaluationOutputSchema,
  system:
    "You are a strict content quality evaluator. Score each dimension strictly against its definition in evaluationContract.dimensionDefinitions. Score honestly; never invent citations; flag unsupported claims as critical.",
  temperature: 0,
  user: JSON.stringify({
    article: {
      body: input.body,
      summary: input.summary,
      title: input.title,
    },
    evaluationContract: {
      dimensions: ["geo", "originality", "quality", "seo", "siteFit"],
      dimensionDefinitions: {
        geo: "How reliably an AI answer engine could find, extract and attribute the article's key claims: key facts (who, what, when, numbers) are stated plainly in self-contained sentences that keep their meaning when quoted alone; every conclusion is traceable to a source cited in the article; people, organizations, drugs, conditions and places are named consistently, with the full name at first mention. Keyword repetition, an authoritative tone or promotional language must not raise this score.",
        originality:
          "Information gain beyond the cited sources: local context, expert interpretation, comparison or synthesis that the sources do not already provide. Close paraphrase or translation of a source scores low.",
        quality:
          "Accuracy, clarity and structure for the site's readers: correct facts, a coherent argument, headings and paragraphs that are easy to follow, no filler.",
        seo: "Search-result readiness: the title and summary state the topic precisely and match the body; headings describe their sections; no keyword stuffing and no clickbait.",
        siteFit: "Fit with the target site's audience, angle and tone as described in site.",
      },
      issues: [{ recommendation: "how to fix", severity: "info|minor|major|high|critical" }],
      output: { overall: "0-100", schemaVersion: 1 },
      recommendations: ["concrete editorial actions"],
    },
    site: { angle: input.siteAngle, name: input.siteName },
  }),
})

/**
 * Versioned LLM quality evaluation with fail-closed behavior: provider
 * failures, malformed output, and invalid thresholds yield an `error` record,
 * never an optimistic score. A scored record carries the full persistence
 * evidence (prompt version, model, input hash, raw-response hash, latency).
 */
export const runLlmEvaluation = async (
  deps: EvaluationDeps,
  input: EvaluationInput,
): Promise<LlmEvaluationRecord> => {
  const thresholds = input.thresholds ?? DEFAULT_LLM_GATE_THRESHOLDS
  const thresholdsHash = llmThresholdsHash(thresholds)
  const inputHash = evaluationInputHash(input)
  const promptVersion = QUALITY_EVALUATION_PROMPT_VERSION
  try {
    const result = await deps.provider.generate(buildEvaluationRequest(input, promptVersion))
    const parsed = parseLlmEvaluationOutput(result.content)
    if (parsed.kind === "invalid") {
      return {
        classification: "PROVIDER_MALFORMED_RESPONSE",
        detail: `evaluation output failed the v${String(1)} contract`,
        inputHash,
        kind: "error",
        parseIssues: parsed.issues,
        promptVersion,
        retryability: "terminal",
        thresholdsHash,
      }
    }
    return {
      classification: classifyLlmEvaluation(parsed.output, thresholds).state,
      decision: classifyLlmEvaluation(parsed.output, thresholds),
      inputHash,
      kind: "scored",
      latencyMs: result.latencyMs,
      modelId: result.modelId,
      output: parsed.output,
      promptVersion,
      providerId: result.providerId,
      rawResponseHash: result.rawResponseHash,
      thresholdsHash,
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      return {
        classification: error.code,
        detail: error.message,
        inputHash,
        kind: "error",
        parseIssues: [],
        promptVersion,
        retryability: error.retryability,
        thresholdsHash,
      }
    }
    return {
      classification: "EVALUATION_UNEXPECTED_ERROR",
      detail: error instanceof Error ? error.message : String(error),
      inputHash,
      kind: "error",
      parseIssues: [],
      promptVersion,
      retryability: undefined,
      thresholdsHash,
    }
  }
}

/** Assessment persistence shape consumed by the CMS internal endpoint. */
export const toAssessmentRequest = (record: LlmEvaluationRecord): RecordAssessmentRequest => {
  if (record.kind === "error") {
    return {
      inputHash: record.inputHash,
      issues: [],
      modelId: "unknown",
      promptVersion: record.promptVersion,
      provider: "unknown",
      state: "error",
      thresholdsHash: record.thresholdsHash,
    }
  }
  return {
    dimensions: { ...record.output.dimensions },
    inputHash: record.inputHash,
    issues: record.output.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
    })),
    modelId: record.modelId,
    overall: record.output.overall,
    promptVersion: record.promptVersion,
    provider: record.providerId,
    state: record.decision.state,
    thresholdsHash: record.thresholdsHash,
  }
}

/** Log/evidence projection: redacts the article body but keeps every hash. */
export const toRedactedEvidence = (
  record: LlmEvaluationRecord,
  input: EvaluationInput,
): Record<string, unknown> => ({
  body: redactEvaluationText(JSON.stringify(input.body)),
  detail: record.kind === "error" ? record.detail : undefined,
  inputHash: record.inputHash,
  kind: record.kind,
  promptVersion: record.promptVersion,
  rawResponseHash: record.kind === "scored" ? record.rawResponseHash : null,
  state: record.kind === "error" ? "error" : record.decision.state,
  summary: redactEvaluationText(input.summary),
  thresholdsHash: record.thresholdsHash,
  title: redactEvaluationText(input.title),
})

export { llmGateThresholdsSchema }

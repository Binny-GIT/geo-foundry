import type {
  ContentServiceClient,
  EditionInput,
  RecordAssessmentRequest,
} from "@geo/content-client"
import {
  aggregateQualityGate,
  runDeterministicRules,
  type QualityAggregate,
} from "@geo/quality-rules"
import type { ArticlePage } from "@geo/schema"

import { canonicalJson, sha256Hex } from "../canonical.js"
import { runSemanticCheck } from "../embeddings/semantic-check.js"
import { runLlmEvaluation, toAssessmentRequest } from "../evaluation/llm-evaluation.js"
import type { LLMProvider } from "../providers/types.js"

export type EvaluationDeps = {
  readonly client: Pick<
    ContentServiceClient,
    "findSimilarEditions" | "getEditionInput" | "recordAssessment" | "storeEmbedding"
  >
  readonly provider: LLMProvider
}

export type EvaluateEditionInput = {
  readonly editionId: number
  readonly siteAngle: string
  readonly siteName: string
  readonly thresholds?: { dimensionMin: number; overallMin: number }
}

export type EditionEvaluation = {
  readonly aggregate: QualityAggregate
  readonly assessmentId: number
}

const evidenceIdOf = (layer: string, payload: unknown): string =>
  `${layer}:${sha256Hex(canonicalJson(payload))}`

/**
 * Three-layer gate for one edition: deterministic rules over the draft
 * document, semantic similarity, and the versioned LLM evaluation, merged by
 * the pure aggregator and persisted as one immutable assessment against the
 * exact edition input hash.
 */
export const evaluateEdition = async (
  deps: EvaluationDeps,
  input: EvaluateEditionInput & { readonly document: ArticlePage },
): Promise<EditionEvaluation> => {
  const snapshot: EditionInput = await deps.client.getEditionInput(input.editionId)
  const deterministic = runDeterministicRules({ document: input.document })
  const semantic = await runSemanticCheck(
    { client: deps.client, provider: deps.provider },
    {
      content: canonicalJson(snapshot.body),
      editionId: input.editionId,
      requestId: `evaluate-${input.editionId}`,
      title: typeof snapshot.title === "string" ? snapshot.title : "Untitled draft",
    },
  )
  const llm = await runLlmEvaluation(
    { provider: deps.provider },
    {
      body: input.document.body as unknown[],
      requestId: `evaluate-${input.editionId}`,
      siteAngle: input.siteAngle,
      siteName: input.siteName,
      summary: typeof snapshot.summary === "string" ? snapshot.summary : "",
      ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
      title: typeof snapshot.title === "string" ? snapshot.title : "Untitled draft",
    },
  )

  const aggregate = aggregateQualityGate({
    deterministic: {
      evidenceId: evidenceIdOf("det", deterministic.issues),
      inputHash: snapshot.inputHash,
      kind: "deterministic",
      result: deterministic,
    },
    expectedInputHash: snapshot.inputHash,
    llm: {
      decision: llm.kind === "scored" ? llm.decision : undefined,
      error:
        llm.kind === "error"
          ? { classification: llm.classification, retryability: llm.retryability }
          : undefined,
      evidenceId: llm.kind === "scored" ? `${llm.rawResponseHash}` : evidenceIdOf("llm", llm),
      inputHash: snapshot.inputHash,
      kind: "llm",
      output: llm.kind === "scored" ? llm.output : undefined,
      thresholds: input.thresholds,
    },
    semantic: {
      decision: semantic.kind === "assessed" ? semantic.decision : undefined,
      error:
        semantic.kind === "error"
          ? { classification: semantic.code, retryability: semantic.retryability }
          : undefined,
      evidenceId:
        semantic.kind === "assessed"
          ? evidenceIdOf("sem", semantic.decision.topMatches)
          : evidenceIdOf("sem-error", semantic.code),
      inputHash: snapshot.inputHash,
      kind: "semantic",
    },
  })

  const assessment = await deps.client.recordAssessment(
    input.editionId,
    aggregateAssessmentRequest(aggregate, llm.kind === "scored" ? toAssessmentRequest(llm) : null),
  )
  return { aggregate, assessmentId: assessment.assessmentId }
}

const aggregateAssessmentRequest = (
  aggregate: QualityAggregate,
  llmAssessment: RecordAssessmentRequest | null,
): RecordAssessmentRequest => ({
  dimensions: (aggregate.dimensions ?? undefined) as Record<string, number> | undefined,
  inputHash: aggregate.inputHash,
  issues: aggregate.issues.map((issue) => ({ code: issue.code, severity: issue.severity })),
  modelId: llmAssessment?.modelId ?? "aggregate",
  overall: aggregate.overall ?? undefined,
  promptVersion: llmAssessment?.promptVersion ?? "aggregate-v1",
  provider: llmAssessment?.provider ?? "geo-quality-gate",
  state: aggregate.assessmentState,
  thresholdsHash: llmAssessment?.thresholdsHash ?? sha256Hex("aggregate"),
})

export type EvaluationOperationInput = {
  readonly attempt: number
  readonly editionId: number
  readonly operationId: string
  readonly siteAngle?: string
  readonly siteName?: string
  readonly thresholds?: { dimensionMin: number; overallMin: number }
}

/** Operation wrapper: records the evaluation stage on the ledger. */
export const runEvaluationOperation = async (
  deps: EvaluationDeps,
  input: EvaluationOperationInput,
  documentOf: (edition: EditionInput) => ArticlePage,
): Promise<EditionEvaluation> => {
  const snapshot = await deps.client.getEditionInput(input.editionId)
  return evaluateEdition(deps, {
    document: documentOf(snapshot),
    editionId: input.editionId,
    siteAngle: input.siteAngle ?? "default",
    siteName: input.siteName ?? "site",
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  })
}

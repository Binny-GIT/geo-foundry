import type {
  ContentServiceClient,
  EditionInput,
  EvaluateSiteThresholds,
  RecordAssessmentRequest,
} from "@geo/content-client"
import {
  aggregateQualityGate,
  runDeterministicRules,
  type QualityAggregate,
  type SemanticDecision,
  DEFAULT_LLM_GATE_THRESHOLDS,
  DEFAULT_SEMANTIC_THRESHOLDS,
  type LlmGateThresholds,
} from "@geo/quality-rules"
import type { ArticlePage } from "@geo/schema"

import { canonicalJson, sha256Hex } from "../canonical.js"
import { runSemanticCheck } from "../embeddings/semantic-check.js"
import { llmThresholdsHash, runLlmEvaluation, toAssessmentRequest } from "../evaluation/llm-evaluation.js"
import { ProviderError } from "../providers/errors.js"
import type { EmbeddingResult, LLMProvider } from "../providers/types.js"

export type EvaluationDeps = {
  readonly client: Pick<
    ContentServiceClient,
    "findSimilarEditions" | "getEditionInput" | "recordAssessment" | "storeEmbedding"
  >
  readonly provider: LLMProvider
}

/** A3：单站评估计划（站点 ID + 入队时的阈值快照），来自评估任务 payload。 */
export type EvaluateSitePlan = EvaluateSiteThresholds

/** A3 前的旧任务没有 sites 快照：回退文章单数站点 + 包默认阈值。 */
const legacySitePlanOf = (siteId: number): EvaluateSitePlan => ({
  crossDomainBlock: DEFAULT_SEMANTIC_THRESHOLDS.crossDomainBlock,
  crossDomainReview: DEFAULT_SEMANTIC_THRESHOLDS.crossDomainReview,
  dimensionMin: DEFAULT_LLM_GATE_THRESHOLDS.dimensionMin,
  overallMin: DEFAULT_LLM_GATE_THRESHOLDS.overallMin,
  sameSiteTitleBlock: DEFAULT_SEMANTIC_THRESHOLDS.sameSiteTitleBlock,
  siteId,
})

export type EvaluateEditionInput = {
  readonly editionId: number
  readonly siteAngle: string
  readonly siteName: string
  readonly thresholds?: { dimensionMin: number; overallMin: number }
  // A3 质量检查按站：按成员站扇出的计划；缺省 = 单站（文章单数站点）旧行为。
  readonly sites?: readonly EvaluateSitePlan[]
}

export type SiteEvaluationResult = {
  readonly aggregate: QualityAggregate
  readonly assessmentId: number
  readonly siteId: number
}

export type EditionEvaluation = {
  readonly assessmentIds: readonly number[]
  readonly perSite: readonly SiteEvaluationResult[]
}

const evidenceIdOf = (layer: string, payload: unknown): string =>
  `${layer}:${sha256Hex(canonicalJson(payload))}`

/**
 * A3 质量检查按站：确定性规则与 LLM 打分各跑一次（站点无关），语义层与
 * LLM 阈值判定按成员站各跑一次（语义锚定该站、阈值用该站入队快照），
 * 每个成员站落一条 immutable assessment（site_id = 该站），并把结论写回
 * edition_sites.quality_state（CMS 端同事务完成）。站点集合变更 = 该站
 * 没有新的 assessment = 编译门禁拦截，必须重新评估。
 */
export const evaluateEdition = async (
  deps: EvaluationDeps,
  input: EvaluateEditionInput & { readonly document: ArticlePage },
): Promise<EditionEvaluation> => {
  const snapshot: EditionInput = await deps.client.getEditionInput(input.editionId)
  const plans =
    input.sites !== undefined && input.sites.length > 0 ? input.sites : [legacySitePlanOf(snapshot.siteId)]
  const llmThresholdsOf = (plan: EvaluateSitePlan): LlmGateThresholds =>
    input.thresholds ?? {
      dimensionMin: plan.dimensionMin,
      overallMin: plan.overallMin,
    }

  const title = typeof snapshot.title === "string" ? snapshot.title : "Untitled draft"
  const content = canonicalJson(snapshot.body)
  const deterministic = runDeterministicRules({ document: input.document })
  // LLM 只打分一次；每站的阈值判定在 aggregateQualityGate 内按该站快照执行。
  const llm = await runLlmEvaluation(
    { provider: deps.provider },
    {
      body: input.document.body as unknown[],
      requestId: `evaluate-${input.editionId}`,
      siteAngle: input.siteAngle,
      siteName: input.siteName,
      summary: typeof snapshot.summary === "string" ? snapshot.summary : "",
      title,
    },
  )
  const deterministicLayer = {
    evidenceId: evidenceIdOf("det", deterministic.issues),
    inputHash: snapshot.inputHash,
    kind: "deterministic" as const,
    result: deterministic,
  }
  const llmLayerBase = {
    // 每站阈值判定由 aggregateQualityGate 用该站快照重算；这里的 decision
    // 仅按默认阈值产出，聚合器只消费 output + thresholds。
    decision: llm.kind === "scored" ? llm.decision : undefined,
    error:
      llm.kind === "error"
        ? { classification: llm.classification, retryability: llm.retryability }
        : undefined,
    inputHash: snapshot.inputHash,
    kind: "llm" as const,
    output: llm.kind === "scored" ? llm.output : undefined,
  }
  const llmEvidenceId =
    llm.kind === "scored" ? `${llm.rawResponseHash}` : evidenceIdOf("llm", llm)

  // 向量只算一次，按站扇出共享；embed 失败时所有站的语义层同码 fail-closed。
  let sharedEmbeddings: { content: EmbeddingResult; title: EmbeddingResult } | null = null
  let embedFailure:
    | { classification: string; retryability: "retryable" | "terminal" | undefined }
    | null = null
  try {
    const [titleEmbedding, contentEmbedding] = await Promise.all([
      deps.provider.embed({ input: title, requestId: `evaluate-${input.editionId}` }),
      deps.provider.embed({ input: content, requestId: `evaluate-${input.editionId}` }),
    ])
    sharedEmbeddings = { content: contentEmbedding, title: titleEmbedding }
  } catch (error) {
    embedFailure = {
      classification: error instanceof ProviderError ? error.code : "SEMANTIC_CHECK_UNEXPECTED",
      retryability: error instanceof ProviderError ? error.retryability : undefined,
    }
  }

  type SemanticLayerState = {
    decision: SemanticDecision | undefined
    error: { classification: string; retryability: "retryable" | "terminal" | undefined } | undefined
    evidenceId: string
    inputHash: string
    kind: "semantic"
  }
  const perSite: SiteEvaluationResult[] = []
  for (const plan of plans) {
    const siteIdField = plan.siteId > 0 ? { siteId: plan.siteId } : {}
    let semanticLayer: SemanticLayerState
    if (sharedEmbeddings === null || embedFailure !== null) {
      semanticLayer = {
        decision: undefined,
        error: embedFailure ?? undefined,
        evidenceId: evidenceIdOf("sem-error", embedFailure?.classification ?? "embedding-failed"),
        inputHash: snapshot.inputHash,
        kind: "semantic",
      }
    } else {
      const semantic = await runSemanticCheck(
        { client: deps.client, provider: deps.provider },
        {
          content,
          embeddings: sharedEmbeddings,
          editionId: input.editionId,
          requestId: `evaluate-${input.editionId}`,
          ...siteIdField,
          thresholds: {
            crossDomainBlock: plan.crossDomainBlock,
            crossDomainReview: plan.crossDomainReview,
            sameSiteTitleBlock: plan.sameSiteTitleBlock,
          },
          title,
        },
      )
      semanticLayer = {
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
      }
    }
    const llmThresholds = llmThresholdsOf(plan)
    const aggregate = aggregateQualityGate({
      deterministic: deterministicLayer,
      expectedInputHash: snapshot.inputHash,
      llm: {
        ...llmLayerBase,
        evidenceId: llmEvidenceId,
        thresholds: llmThresholds,
      },
      semantic: semanticLayer,
    })
    const assessment = await deps.client.recordAssessment(
      input.editionId,
      aggregateAssessmentRequest(
        aggregate,
        llm.kind === "scored" ? toAssessmentRequest(llm) : null,
        llmThresholds,
        plan.siteId,
      ),
    )
    perSite.push({ aggregate, assessmentId: assessment.assessmentId, siteId: plan.siteId })
  }
  return {
    assessmentIds: perSite.map((result) => result.assessmentId),
    perSite,
  }
}

const aggregateAssessmentRequest = (
  aggregate: QualityAggregate,
  llmAssessment: RecordAssessmentRequest | null,
  llmThresholds: LlmGateThresholds,
  siteId: number,
): RecordAssessmentRequest => ({
  dimensions: (aggregate.dimensions ?? undefined) as Record<string, number> | undefined,
  inputHash: aggregate.inputHash,
  issues: aggregate.issues.map((issue) => ({ code: issue.code, severity: issue.severity })),
  modelId: llmAssessment?.modelId ?? "aggregate",
  overall: aggregate.overall ?? undefined,
  promptVersion: llmAssessment?.promptVersion ?? "aggregate-v1",
  provider: llmAssessment?.provider ?? "geo-quality-gate",
  // A3：按站落结论；siteId 非正数（历史单站缺失）时不传，CMS 回退文章单数站点。
  ...(siteId > 0 ? { siteId } : {}),
  state: aggregate.assessmentState,
  thresholdsHash: llmThresholdsHash(llmThresholds),
})

export type EvaluationOperationInput = {
  readonly attempt: number
  readonly editionId: number
  readonly operationId: string
  readonly siteAngle?: string
  readonly siteName?: string
  readonly thresholds?: { dimensionMin: number; overallMin: number }
  readonly sites?: readonly EvaluateSitePlan[]
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
    ...(input.sites === undefined ? {} : { sites: input.sites }),
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  })
}

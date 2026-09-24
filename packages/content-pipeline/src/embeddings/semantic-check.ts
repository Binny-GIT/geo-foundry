import { createHash } from "node:crypto"

import {
  ContentClientError,
  type ContentServiceClient,
  type SimilarityMatch,
} from "@geo/content-client"
import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  decideSemantic,
  serializeSemanticThresholds,
  type SemanticComparison,
  type SemanticDecision,
  type SemanticScope,
  type SemanticThresholds,
} from "@geo/quality-rules"

import { ProviderError } from "../providers/errors.js"
import type { EmbeddingResult, LLMProvider } from "../providers/types.js"

/** Candidate rows fetched per comparison; the gate only needs the nearest. */
export const SEMANTIC_CANDIDATE_LIMIT = 5

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex")

export const semanticThresholdsHash = (thresholds: SemanticThresholds): string =>
  sha256(serializeSemanticThresholds(thresholds))

export type SemanticCheckDeps = {
  readonly client: Pick<ContentServiceClient, "findSimilarEditions" | "storeEmbedding">
  readonly provider: LLMProvider
}

export type SemanticCheckInput = {
  readonly content: string
  readonly editionId: number
  readonly requestId: string
  // A3 质量检查按站：本次检查的目标站点（落库站点 + 相似度锚点）；
  // 缺省由 CMS 端锚定文章单数站点（A3 之前的行为）。
  readonly siteId?: number
  // A3：多站扇出时向量只算一次，由调用方共享传入，跳过重复 embed。
  readonly embeddings?: {
    readonly content: EmbeddingResult
    readonly title: EmbeddingResult
  }
  readonly thresholds?: SemanticThresholds
  readonly title: string
}

export type SemanticCheckAssessed = {
  readonly decision: SemanticDecision
  readonly embeddingModelId: string
  readonly inputHashes: { readonly content: string; readonly title: string }
  readonly kind: "assessed"
  readonly providerId: string
  readonly thresholdsHash: string
}

export type SemanticCheckError = {
  readonly code: string
  readonly detail: string
  readonly kind: "error"
  readonly retryability: "retryable" | "terminal" | undefined
  readonly thresholdsHash: string
}

export type SemanticCheckResult = SemanticCheckAssessed | SemanticCheckError

const scopedInputHash = (modelId: string, scope: SemanticScope, input: string): string =>
  sha256(`${modelId}\n${scope}\n${input}`)

const toSemanticMatch = (
  comparison: SemanticComparison,
  scope: SemanticScope,
  match: SimilarityMatch,
) => ({ ...match, comparison, scope })

/**
 * Semantic similarity layer of the quality gate: embed the edition title and
 * body through the single approved provider, persist both vectors with their
 * exact input hashes, query cross-domain and same-site candidates, and apply
 * the persisted threshold snapshot. Fail-closed: any provider or store
 * failure yields `kind: "error"`, never an optimistic pass.
 */
export const runSemanticCheck = async (
  deps: SemanticCheckDeps,
  input: SemanticCheckInput,
): Promise<SemanticCheckResult> => {
  const thresholds = input.thresholds ?? DEFAULT_SEMANTIC_THRESHOLDS
  const thresholdsHash = semanticThresholdsHash(thresholds)
  if (input.title.length === 0 || input.content.length === 0) {
    return {
      code: "SEMANTIC_INPUT_INVALID",
      detail: "title and content must be non-empty embedding inputs",
      kind: "error",
      retryability: "terminal",
      thresholdsHash,
    }
  }
  const { provider } = deps
  const siteIdField = input.siteId === undefined ? {} : { siteId: input.siteId }
  try {
    const [titleEmbedding, contentEmbedding] =
      input.embeddings === undefined
        ? await Promise.all([
            provider.embed({ input: input.title, requestId: input.requestId }),
            provider.embed({ input: input.content, requestId: input.requestId }),
          ])
        : [input.embeddings.title, input.embeddings.content]
    const inputHashes = {
      content: scopedInputHash(provider.embeddingModelId, "content", input.content),
      title: scopedInputHash(provider.embeddingModelId, "title", input.title),
    }
    await deps.client.storeEmbedding(input.editionId, {
      dimension: titleEmbedding.dimension,
      inputHash: inputHashes.title,
      modelId: titleEmbedding.modelId,
      scope: "title",
      ...siteIdField,
      vector: [...titleEmbedding.vector],
    })
    await deps.client.storeEmbedding(input.editionId, {
      dimension: contentEmbedding.dimension,
      inputHash: inputHashes.content,
      modelId: contentEmbedding.modelId,
      scope: "content",
      ...siteIdField,
      vector: [...contentEmbedding.vector],
    })
    const [crossDomainContent, sameSiteTitle, sameSiteContent] = await Promise.all([
      deps.client.findSimilarEditions(input.editionId, {
        comparison: "cross-domain",
        dimension: contentEmbedding.dimension,
        limit: SEMANTIC_CANDIDATE_LIMIT,
        modelId: contentEmbedding.modelId,
        scope: "content",
        ...siteIdField,
        vector: [...contentEmbedding.vector],
      }),
      deps.client.findSimilarEditions(input.editionId, {
        comparison: "same-site",
        dimension: titleEmbedding.dimension,
        limit: SEMANTIC_CANDIDATE_LIMIT,
        modelId: titleEmbedding.modelId,
        scope: "title",
        ...siteIdField,
        vector: [...titleEmbedding.vector],
      }),
      deps.client.findSimilarEditions(input.editionId, {
        comparison: "same-site",
        dimension: contentEmbedding.dimension,
        limit: SEMANTIC_CANDIDATE_LIMIT,
        modelId: contentEmbedding.modelId,
        scope: "content",
        ...siteIdField,
        vector: [...contentEmbedding.vector],
      }),
    ])
    const decision = decideSemantic({
      matches: [
        ...crossDomainContent.map((match) => toSemanticMatch("cross-domain", "content", match)),
        ...sameSiteTitle.map((match) => toSemanticMatch("same-site", "title", match)),
        ...sameSiteContent.map((match) => toSemanticMatch("same-site", "content", match)),
      ],
      thresholds,
    })
    return {
      decision,
      embeddingModelId: contentEmbedding.modelId,
      inputHashes,
      kind: "assessed",
      providerId: provider.providerId,
      thresholdsHash,
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      return {
        code: error.code,
        detail: error.message,
        kind: "error",
        retryability: error.retryability,
        thresholdsHash,
      }
    }
    if (error instanceof ContentClientError) {
      return {
        code: error.code,
        detail: error.message,
        kind: "error",
        retryability: undefined,
        thresholdsHash,
      }
    }
    return {
      code: "SEMANTIC_CHECK_UNEXPECTED",
      detail: error instanceof Error ? error.message : String(error),
      kind: "error",
      retryability: undefined,
      thresholdsHash,
    }
  }
}

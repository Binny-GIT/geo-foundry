import { sql } from "@payloadcms/db-postgres"
import type { Payload } from "payload"

import {
  anchorOf,
  EmbeddingStoreError,
  EMBEDDING_STORE_ERROR,
  validateVector,
  type EmbeddingEditionAnchor,
  type EmbeddingScope,
  type SemanticComparison,
} from "./embedding-store"

export type SimilarityQueryInput = {
  readonly comparison: SemanticComparison
  readonly dimension: number
  readonly editionId: number
  readonly limit: number
  readonly modelId: string
  readonly scope: EmbeddingScope
  readonly user: unknown
  readonly vector: readonly number[]
}

export type SimilarityMatchRow = {
  readonly editionId: number
  readonly inputHash: string
  readonly siteId: number
  readonly similarity: number
  readonly title: string | null
}

type MatchRow = {
  edition_id: number | string
  input_hash: string
  site_id: number | string
  similarity: number | string
  title: string | null
}

const similarityQuery = (input: {
  readonly anchor: EmbeddingEditionAnchor
  readonly comparison: SemanticComparison
  readonly dimension: number
  readonly limit: number
  readonly modelId: string
  readonly scope: EmbeddingScope
  readonly vectorLiteral: string
}) => {
  const sitePredicate =
    input.comparison === "cross-domain"
      ? sql`"e"."site_id" <> ${input.anchor.siteId}`
      : sql`"e"."site_id" = ${input.anchor.siteId}`
  return sql`
    SELECT "e"."edition_id", "e"."site_id", "e"."input_hash", "ce"."title",
           round((1 - ("e"."embedding" OPERATOR(public.<=>) ${input.vectorLiteral}::public.vector))::numeric, 6)::float8 AS "similarity"
    FROM "geo_foundry"."embeddings" "e"
    JOIN "geo_foundry"."content_editions" "ce" ON "ce"."id" = "e"."edition_id"
    WHERE "e"."tenant_id" = ${input.anchor.tenantId}
      AND "e"."scope" = ${input.scope}
      AND "e"."model_id" = ${input.modelId}
      AND "e"."dimension" = ${input.dimension}
      AND "e"."edition_id" <> ${input.anchor.editionId}
      AND ${sitePredicate}
    ORDER BY "e"."embedding" OPERATOR(public.<=>) ${input.vectorLiteral}::public.vector
    LIMIT ${input.limit}`
}

export async function findSimilarEditions(
  payload: Payload,
  input: SimilarityQueryInput,
): Promise<readonly SimilarityMatchRow[]> {
  const anchor = await anchorOf(payload, input.editionId, input.user)
  const vectorLiteral = validateVector(input.vector, input.dimension)
  try {
    const result = await payload.db.drizzle.execute(
      similarityQuery({
        anchor,
        comparison: input.comparison,
        dimension: input.dimension,
        limit: input.limit,
        modelId: input.modelId,
        scope: input.scope,
        vectorLiteral,
      }),
    )
    const rows = result.rows as unknown as MatchRow[]
    return rows
      .map((row) => ({
        editionId: Number(row.edition_id),
        inputHash: row.input_hash,
        siteId: Number(row.site_id),
        similarity: Number(row.similarity),
        title: row.title,
      }))
      .sort((left, right) =>
        left.similarity !== right.similarity
          ? right.similarity - left.similarity
          : left.editionId - right.editionId,
      )
  } catch (error) {
    if (error instanceof EmbeddingStoreError) {
      throw error
    }
    throw new EmbeddingStoreError(
      EMBEDDING_STORE_ERROR.STORE_UNAVAILABLE,
      error instanceof Error ? error.message : "pgvector query failure",
    )
  }
}

/**
 * Test-support EXPLAIN over the exact similarity query so integration
 * evidence can prove the HNSW index is selected above the fixture scale
 * threshold. Read-only; never mutates planner settings.
 */
export async function explainSimilarityQuery(
  payload: Payload,
  input: SimilarityQueryInput,
): Promise<readonly unknown[]> {
  const anchor = await anchorOf(payload, input.editionId, input.user)
  const vectorLiteral = validateVector(input.vector, input.dimension)
  const result = await payload.db.drizzle.execute(sql`
    EXPLAIN (FORMAT JSON) ${similarityQuery({
      anchor,
      comparison: input.comparison,
      dimension: input.dimension,
      limit: input.limit,
      modelId: input.modelId,
      scope: input.scope,
      vectorLiteral,
    })}`)
  return result.rows as unknown as readonly unknown[]
}

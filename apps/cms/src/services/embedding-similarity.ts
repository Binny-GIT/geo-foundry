import { sql } from "drizzle-orm"

import type { ServerDb } from "../server/db/client"
import { contentEditions } from "../server/db/edition-schema"
import { embeddings } from "../server/db/entity-schema"

import {
  anchorOf,
  EMBEDDING_STORE_ERROR,
  type EmbeddingEditionAnchor,
  type EmbeddingScope,
  EmbeddingStoreError,
  type SemanticComparison,
  validateVector,
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
      ? sql`${embeddings.siteId} <> ${input.anchor.siteId}`
      : sql`${embeddings.siteId} = ${input.anchor.siteId}`
  return sql`
    SELECT ${embeddings.editionId}, ${embeddings.siteId}, ${embeddings.inputHash}, ${contentEditions.title},
           round((1 - (${embeddings.embedding} OPERATOR(public.<=>) ${input.vectorLiteral}::public.vector))::numeric, 6)::float8 AS "similarity"
    FROM ${embeddings}
    JOIN ${contentEditions} ON ${contentEditions.id} = ${embeddings.editionId}
    WHERE ${embeddings.tenantId} = ${input.anchor.tenantId}
      AND ${embeddings.scope} = ${input.scope}
      AND ${embeddings.modelId} = ${input.modelId}
      AND ${embeddings.dimension} = ${input.dimension}
      AND ${embeddings.editionId} <> ${input.anchor.editionId}
      AND ${sitePredicate}
    ORDER BY ${embeddings.embedding} OPERATOR(public.<=>) ${input.vectorLiteral}::public.vector
    LIMIT ${input.limit}`
}

export async function findSimilarEditions(
  db: ServerDb,
  input: SimilarityQueryInput,
): Promise<readonly SimilarityMatchRow[]> {
  const anchor = await anchorOf(db, input.editionId, input.user)
  const vectorLiteral = validateVector(input.vector, input.dimension)
  try {
    const result = await db.execute(
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
  db: ServerDb,
  input: SimilarityQueryInput,
): Promise<readonly unknown[]> {
  const anchor = await anchorOf(db, input.editionId, input.user)
  const vectorLiteral = validateVector(input.vector, input.dimension)
  const result = await db.execute(sql`
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

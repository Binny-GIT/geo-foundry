import { createHash } from "node:crypto"
import { sql } from "@payloadcms/db-postgres"
import type { Payload } from "payload"

import {
  assertEditionTenantScope,
  loadWorkflowEdition,
  numberFieldOf,
  requireServiceIdentity,
} from "./edition-workflow"

/** The single pgvector column dimension pinned by the task20 migration. */
export const EMBEDDING_DIMENSION = 1536

export const EMBEDDING_STORE_ERROR = {
  DIMENSION_MISMATCH: "EMBEDDING_DIMENSION_MISMATCH",
  EDITION_NOT_FOUND: "EMBEDDING_EDITION_NOT_FOUND",
  STORE_UNAVAILABLE: "EMBEDDING_STORE_UNAVAILABLE",
  TENANT_MISMATCH: "EMBEDDING_TENANT_MISMATCH",
  VECTOR_INVALID: "EMBEDDING_VECTOR_INVALID",
} as const

export type EmbeddingStoreErrorCode =
  (typeof EMBEDDING_STORE_ERROR)[keyof typeof EMBEDDING_STORE_ERROR]

export class EmbeddingStoreError extends Error {
  override readonly name = "EmbeddingStoreError"

  constructor(
    readonly code: EmbeddingStoreErrorCode,
    readonly detail?: string,
  ) {
    super(code)
  }
}

export type EmbeddingScope = "content" | "title"
export type SemanticComparison = "cross-domain" | "same-site"

export type EmbeddingEditionAnchor = {
  readonly editionId: number
  readonly siteId: number
  readonly tenantId: number
}

export const anchorOf = async (
  payload: Payload,
  editionId: number,
  user: unknown,
): Promise<EmbeddingEditionAnchor> => {
  requireServiceIdentity(user)
  const doc = await loadWorkflowEdition(payload, editionId, {}, true)
  assertEditionTenantScope(user, doc)
  return {
    editionId: doc.id,
    siteId: numberFieldOf(doc.site) ?? -1,
    tenantId: numberFieldOf(doc.tenant) ?? -1,
  }
}

const vectorLiteralOf = (vector: readonly number[]): string => `[${vector.join(",")}]`

export const validateVector = (vector: readonly number[], dimension: number): string => {
  if (dimension !== EMBEDDING_DIMENSION) {
    throw new EmbeddingStoreError(
      EMBEDDING_STORE_ERROR.DIMENSION_MISMATCH,
      `the embeddings table stores dimension ${EMBEDDING_DIMENSION}, received ${dimension}`,
    )
  }
  if (vector.length !== dimension || !vector.every((component) => Number.isFinite(component))) {
    throw new EmbeddingStoreError(
      EMBEDDING_STORE_ERROR.VECTOR_INVALID,
      `expected ${dimension} finite components, received ${vector.length}`,
    )
  }
  return vectorLiteralOf(vector)
}

/**
 * Canonical identity of a stored embedding: every input that can change the
 * meaning of a vector (tenant, site, edition, scope, model, dimension, input
 * hash, and a hash of the vector itself) participates, so the same logical
 * embedding always maps to one row and any changed input creates a new row.
 */
export const embeddingKeyOf = (input: {
  readonly dimension: number
  readonly editionId: number
  readonly inputHash: string
  readonly modelId: string
  readonly scope: EmbeddingScope
  readonly siteId: number
  readonly tenantId: number
  readonly vectorLiteral: string
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        "geo-foundry:embedding:v1",
        input.tenantId,
        input.siteId,
        input.editionId,
        input.scope,
        input.modelId,
        input.dimension,
        input.inputHash,
        createHash("sha256").update(input.vectorLiteral).digest("hex"),
      ]),
    )
    .digest("hex")

export type StoreEmbeddingInput = {
  readonly dimension: number
  readonly editionId: number
  readonly inputHash: string
  readonly modelId: string
  readonly scope: EmbeddingScope
  readonly user: unknown
  readonly vector: readonly number[]
}

export type EmbeddingReceipt = {
  readonly created: boolean
  readonly embeddingId: number
  readonly embeddingKey: string
}

type IdRow = { id: number | string }

export async function storeEditionEmbedding(
  payload: Payload,
  input: StoreEmbeddingInput,
): Promise<EmbeddingReceipt> {
  const anchor = await anchorOf(payload, input.editionId, input.user)
  const vectorLiteral = validateVector(input.vector, input.dimension)
  const embeddingKey = embeddingKeyOf({
    dimension: input.dimension,
    editionId: anchor.editionId,
    inputHash: input.inputHash,
    modelId: input.modelId,
    scope: input.scope,
    siteId: anchor.siteId,
    tenantId: anchor.tenantId,
    vectorLiteral,
  })
  try {
    const inserted = await payload.db.drizzle.execute(sql`
      INSERT INTO "geo_foundry"."embeddings"
        ("embedding_key", "tenant_id", "site_id", "edition_id", "scope", "model_id", "dimension", "input_hash", "embedding")
      VALUES (${embeddingKey}, ${anchor.tenantId}, ${anchor.siteId}, ${anchor.editionId}, ${input.scope}, ${input.modelId}, ${input.dimension}, ${input.inputHash}, ${vectorLiteral}::public.vector)
      ON CONFLICT ("embedding_key") DO NOTHING
      RETURNING "id"`)
    const insertedRows = inserted.rows as unknown as IdRow[]
    if (insertedRows.length > 0 && insertedRows[0] !== undefined) {
      return {
        created: true,
        embeddingId: Number(insertedRows[0].id),
        embeddingKey,
      }
    }
    const existing = await payload.db.drizzle.execute(sql`
      SELECT "id" FROM "geo_foundry"."embeddings" WHERE "embedding_key" = ${embeddingKey}`)
    const existingRows = existing.rows as unknown as IdRow[]
    const row = existingRows[0]
    if (row === undefined) {
      throw new EmbeddingStoreError(
        EMBEDDING_STORE_ERROR.STORE_UNAVAILABLE,
        "insert reported no conflict but the embedding key is absent",
      )
    }
    return { created: false, embeddingId: Number(row.id), embeddingKey }
  } catch (error) {
    if (error instanceof EmbeddingStoreError) {
      throw error
    }
    throw new EmbeddingStoreError(
      EMBEDDING_STORE_ERROR.STORE_UNAVAILABLE,
      error instanceof Error ? error.message : "pgvector store failure",
    )
  }
}

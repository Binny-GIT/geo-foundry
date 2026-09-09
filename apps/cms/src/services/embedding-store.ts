import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { resolveSessionClaims } from "../access/session"
import type { ServerDb } from "../server/db/client"
import { editionVersions } from "../server/db/edition-schema"
import { embeddings } from "../server/db/entity-schema"

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
  db: ServerDb,
  editionId: number,
  user: unknown,
): Promise<EmbeddingEditionAnchor> => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw new EmbeddingStoreError(
      EMBEDDING_STORE_ERROR.EDITION_NOT_FOUND,
      "service identity required",
    )
  }
  const tenantId = Number(claims.tenantId)
  const rows = await db
    .select({ siteId: editionVersions.siteId, tenantId: editionVersions.tenantId })
    .from(editionVersions)
    .where(
      and(
        eq(editionVersions.parentId, editionId),
        eq(editionVersions.latest, true),
        ...(Number.isInteger(tenantId) && tenantId > 0
          ? [eq(editionVersions.tenantId, tenantId)]
          : []),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (row === undefined) {
    throw new EmbeddingStoreError(EMBEDDING_STORE_ERROR.EDITION_NOT_FOUND, `edition ${editionId}`)
  }
  return { editionId, siteId: row.siteId ?? -1, tenantId: row.tenantId ?? -1 }
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
  db: ServerDb,
  input: StoreEmbeddingInput,
): Promise<EmbeddingReceipt> {
  const anchor = await anchorOf(db, input.editionId, input.user)
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
    const inserted = await db.execute(sql`
      INSERT INTO ${embeddings}
        (${embeddings.embeddingKey}, ${embeddings.tenantId}, ${embeddings.siteId}, ${embeddings.editionId}, ${embeddings.scope}, ${embeddings.modelId}, ${embeddings.dimension}, ${embeddings.inputHash}, ${embeddings.embedding})
      VALUES (${embeddingKey}, ${anchor.tenantId}, ${anchor.siteId}, ${anchor.editionId}, ${input.scope}, ${input.modelId}, ${input.dimension}, ${input.inputHash}, ${vectorLiteral}::public.vector)
      ON CONFLICT (${embeddings.embeddingKey}) DO NOTHING
      RETURNING ${embeddings.id}`)
    const insertedRows = inserted.rows as unknown as IdRow[]
    if (insertedRows.length > 0 && insertedRows[0] !== undefined) {
      return {
        created: true,
        embeddingId: Number(insertedRows[0].id),
        embeddingKey,
      }
    }
    const existing = await db.execute(sql`
      SELECT ${embeddings.id} FROM ${embeddings} WHERE ${embeddings.embeddingKey} = ${embeddingKey}`)
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

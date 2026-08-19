export const SEMANTIC_SIMILARITY_ERROR_CODE = {
  EMPTY: "SEMANTIC_VECTOR_EMPTY",
  LENGTH_MISMATCH: "SEMANTIC_VECTOR_LENGTH_MISMATCH",
  NON_FINITE: "SEMANTIC_VECTOR_NON_FINITE",
  ZERO_NORM: "SEMANTIC_VECTOR_ZERO_NORM",
} as const

export class SemanticSimilarityError extends Error {
  override readonly name = "SemanticSimilarityError"

  constructor(
    readonly code: (typeof SEMANTIC_SIMILARITY_ERROR_CODE)[keyof typeof SEMANTIC_SIMILARITY_ERROR_CODE],
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

const validateVector = (values: readonly number[], label: string): void => {
  if (values.length === 0) {
    throw new SemanticSimilarityError(
      SEMANTIC_SIMILARITY_ERROR_CODE.EMPTY,
      `${label} vector is empty`,
    )
  }
  if (!values.every((component) => Number.isFinite(component))) {
    throw new SemanticSimilarityError(
      SEMANTIC_SIMILARITY_ERROR_CODE.NON_FINITE,
      `${label} vector contains a non-finite component`,
    )
  }
}

/**
 * Pure cosine similarity over dense embedding vectors. Embeddings persisted
 * through pgvector round-trip as float4, so callers compare rounded values
 * (see roundSimilarity) instead of raw float arithmetic.
 */
export const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  validateVector(left, "left")
  validateVector(right, "right")
  const mismatch = (): SemanticSimilarityError =>
    new SemanticSimilarityError(
      SEMANTIC_SIMILARITY_ERROR_CODE.LENGTH_MISMATCH,
      `left has ${left.length} components, right has ${right.length}`,
    )
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const rightIterator = right[Symbol.iterator]()
  for (const component of left) {
    const next = rightIterator.next()
    if (next.done === true) {
      throw mismatch()
    }
    dot += component * next.value
    leftNorm += component * component
    rightNorm += next.value * next.value
  }
  if (rightIterator.next().done !== true) {
    throw mismatch()
  }
  if (leftNorm === 0 || rightNorm === 0) {
    throw new SemanticSimilarityError(
      SEMANTIC_SIMILARITY_ERROR_CODE.ZERO_NORM,
      "cosine similarity is undefined for a zero vector",
    )
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

/**
 * Rounds a similarity to the wire precision shared by the pgvector-backed
 * store so boundary comparisons never depend on float8 noise from float4
 * storage.
 */
export const roundSimilarity = (value: number, decimals = 6): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

import { describe, expect, it } from "vitest"

import { SemanticSimilarityError, cosineSimilarity, roundSimilarity } from "../src/index.js"

const closeTo = (value: number, tolerance = 1e-12) => expect.closeTo(value, tolerance)

describe("cosine similarity", () => {
  it("returns 1 for identical unit vectors", () => {
    closeTo(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1)
  })

  it("returns 0 for orthogonal vectors", () => {
    closeTo(cosineSimilarity([1, 0], [0, 1]), 0)
  })

  it("returns -1 for opposite vectors", () => {
    closeTo(cosineSimilarity([2, 0], [-3, 0]), -1)
  })

  it("normalizes vector magnitude", () => {
    closeTo(cosineSimilarity([3, 4], [6, 8]), 1)
  })

  it("computes a known fractional similarity", () => {
    closeTo(cosineSimilarity([1, 2, 3], [3, 2, 1]), 10 / 14)
  })

  it("rejects vectors of different length", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(SemanticSimilarityError)
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/SEMANTIC_VECTOR_LENGTH_MISMATCH/)
    expect(() => cosineSimilarity([1, 0, 0], [1, 0])).toThrow(/SEMANTIC_VECTOR_LENGTH_MISMATCH/)
  })

  it("rejects empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow(SemanticSimilarityError)
  })

  it("rejects non-finite components", () => {
    expect(() => cosineSimilarity([Number.POSITIVE_INFINITY, 0], [1, 0])).toThrow(
      SemanticSimilarityError,
    )
  })

  it("rejects zero vectors", () => {
    expect(() => cosineSimilarity([0, 0], [1, 1])).toThrow(SemanticSimilarityError)
  })
})

describe("roundSimilarity", () => {
  it("rounds to six decimals by default", () => {
    expect(roundSimilarity(0.91999996)).toBe(0.92)
  })

  it("keeps already-rounded values stable", () => {
    expect(roundSimilarity(0.85)).toBe(0.85)
  })
})

import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { DEFAULT_SEMANTIC_THRESHOLDS, decideSemantic, type SemanticMatch } from "../src/index.js"

const matchArbitrary = fc.record({
  comparison: fc.constantFrom("cross-domain" as const, "same-site" as const),
  editionId: fc.integer({ max: 100_000, min: 1 }),
  inputHash: fc.integer({ max: 15, min: 0 }).map((digit) => digit.toString(16).repeat(64)),
  scope: fc.constantFrom("content" as const, "title" as const),
  similarity: fc.float({ max: 1, min: 0, noNaN: true }),
  siteId: fc.integer({ max: 1000, min: 1 }),
  title: fc.option(fc.string({ maxLength: 40, minLength: 0 }), { nil: null }),
})

describe("semantic decision properties", () => {
  it("is deterministic for identical inputs", () => {
    fc.assert(
      fc.property(fc.array(matchArbitrary, { maxLength: 12 }), (rawMatches) => {
        const matches = rawMatches as readonly SemanticMatch[]
        const once = decideSemantic({ matches, thresholds: DEFAULT_SEMANTIC_THRESHOLDS })
        const twice = decideSemantic({ matches, thresholds: DEFAULT_SEMANTIC_THRESHOLDS })
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
      }),
    )
  })

  it("never loosens the outcome when similarities increase", () => {
    const rank = { pass: 0, "review-required": 1, blocked: 2 } as const
    fc.assert(
      fc.property(fc.array(matchArbitrary, { maxLength: 12 }), (rawMatches) => {
        const matches = rawMatches as readonly SemanticMatch[]
        const base = decideSemantic({ matches, thresholds: DEFAULT_SEMANTIC_THRESHOLDS })
        const raised = decideSemantic({
          matches: matches.map((candidate) => ({
            ...candidate,
            similarity: candidate.similarity + (1 - candidate.similarity) / 2,
          })),
          thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
        })
        expect(rank[raised.outcome]).toBeGreaterThanOrEqual(rank[base.outcome])
      }),
    )
  })
})

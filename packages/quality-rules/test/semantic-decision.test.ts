import { describe, expect, it } from "vitest"

import {
  CROSS_DOMAIN_BLOCK_THRESHOLD,
  CROSS_DOMAIN_REVIEW_THRESHOLD,
  DEFAULT_SEMANTIC_THRESHOLDS,
  SAME_SITE_TITLE_BLOCK_THRESHOLD,
  decideSemantic,
  serializeSemanticThresholds,
  sortSemanticMatches,
  type SemanticMatch,
} from "../src/index.js"

const match = (overrides: Partial<SemanticMatch> = {}): SemanticMatch => ({
  comparison: "cross-domain",
  editionId: 20,
  inputHash: "a".repeat(64),
  scope: "content",
  similarity: 0.5,
  siteId: 2,
  title: "Candidate edition",
  ...overrides,
})

describe("semantic thresholds", () => {
  it("exposes the PRD defaults", () => {
    expect(CROSS_DOMAIN_REVIEW_THRESHOLD).toBe(0.85)
    expect(CROSS_DOMAIN_BLOCK_THRESHOLD).toBe(0.92)
    expect(SAME_SITE_TITLE_BLOCK_THRESHOLD).toBe(0.9)
    expect(DEFAULT_SEMANTIC_THRESHOLDS).toEqual({
      crossDomainBlock: 0.92,
      crossDomainReview: 0.85,
      sameSiteTitleBlock: 0.9,
    })
  })

  it("serializes thresholds deterministically over canonical JSON", () => {
    const first = serializeSemanticThresholds(DEFAULT_SEMANTIC_THRESHOLDS)
    const second = serializeSemanticThresholds({
      crossDomainBlock: 0.92,
      crossDomainReview: 0.85,
      sameSiteTitleBlock: 0.9,
    })
    expect(second).toBe(first)
    expect(first).toBe(
      '{"crossDomainBlock":0.92,"crossDomainReview":0.85,"sameSiteTitleBlock":0.9}',
    )
  })

  it("distinguishes serializations for different thresholds", () => {
    expect(
      serializeSemanticThresholds({ ...DEFAULT_SEMANTIC_THRESHOLDS, crossDomainReview: 0.8 }),
    ).not.toBe(serializeSemanticThresholds(DEFAULT_SEMANTIC_THRESHOLDS))
  })
})

describe("decideSemantic gate", () => {
  it("passes when no match reaches any threshold", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.84 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("pass")
    expect(decision.issues).toEqual([])
  })

  it("requires review at the exact cross-domain review boundary", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: CROSS_DOMAIN_REVIEW_THRESHOLD })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("review-required")
    expect(decision.issues.map((issue) => issue.code)).toEqual(["SEMANTIC_CROSS_DOMAIN_REVIEW"])
    expect(decision.issues[0]?.severity).toBe("major")
  })

  it("blocks at the exact cross-domain block boundary", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: CROSS_DOMAIN_BLOCK_THRESHOLD })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_CROSS_DOMAIN_DUPLICATE")
    expect(decision.issues[0]?.severity).toBe("critical")
  })

  it("keeps 0.919 below the block boundary as review", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.919 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("review-required")
  })

  it("blocks same-site title duplicates at 0.90", () => {
    const decision = decideSemantic({
      matches: [
        match({
          comparison: "same-site",
          scope: "title",
          similarity: SAME_SITE_TITLE_BLOCK_THRESHOLD,
        }),
      ],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_SAME_SITE_TITLE_DUPLICATE")
    expect(decision.issues[0]?.severity).toBe("high")
  })

  it("does not gate same-site title similarity below the boundary", () => {
    const decision = decideSemantic({
      matches: [match({ comparison: "same-site", scope: "title", similarity: 0.8999 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("pass")
    expect(decision.issues).toEqual([])
  })

  it("surfaces same-site content similarity as non-blocking info", () => {
    const decision = decideSemantic({
      matches: [match({ comparison: "same-site", scope: "content", similarity: 0.95 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("pass")
    expect(decision.issues.map((issue) => issue.code)).toEqual([
      "SEMANTIC_SAME_SITE_CONTENT_SIMILAR",
    ])
    expect(decision.issues[0]?.severity).toBe("info")
  })

  it("surfaces cross-domain title similarity as non-blocking info", () => {
    const decision = decideSemantic({
      matches: [match({ scope: "title", similarity: 0.9 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("pass")
    expect(decision.issues.map((issue) => issue.code)).toEqual([
      "SEMANTIC_CROSS_DOMAIN_TITLE_SIMILAR",
    ])
  })

  it("prefers blocked over review when both apply", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.86 }), match({ editionId: 21, similarity: 0.93 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues.map((issue) => issue.code)).toEqual([
      "SEMANTIC_CROSS_DOMAIN_DUPLICATE",
      "SEMANTIC_CROSS_DOMAIN_REVIEW",
    ])
  })

  it("applies custom site thresholds from the persisted snapshot", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.82 })],
      thresholds: { ...DEFAULT_SEMANTIC_THRESHOLDS, crossDomainReview: 0.8 },
    })
    expect(decision.outcome).toBe("review-required")
  })

  it("fails closed on invalid thresholds", () => {
    const decision = decideSemantic({
      matches: [],
      thresholds: { crossDomainBlock: 0.5, crossDomainReview: 0.85, sameSiteTitleBlock: 0.9 },
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_THRESHOLDS_INVALID")
    expect(decision.issues[0]?.severity).toBe("critical")
    expect(decision.thresholds).toBeNull()
  })

  it("fails closed on a non-finite similarity", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: Number.NaN })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_MATCH_INVALID")
  })

  it("fails closed on an out-of-range similarity", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 1.5 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_MATCH_INVALID")
  })

  it("returns deterministically sorted top matches", () => {
    const decision = decideSemantic({
      matches: [
        match({ editionId: 31, similarity: 0.81 }),
        match({ editionId: 30, similarity: 0.95 }),
        match({ comparison: "same-site", editionId: 32, similarity: 0.95 }),
      ],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.topMatches.map((candidate) => candidate.editionId)).toEqual([30, 32, 31])
  })

  it("produces byte-identical output for repeated calls", () => {
    const matches = [
      match({ similarity: 0.93 }),
      match({ comparison: "same-site", editionId: 22, scope: "title", similarity: 0.91 }),
    ]
    expect(
      JSON.stringify(decideSemantic({ matches, thresholds: DEFAULT_SEMANTIC_THRESHOLDS })),
    ).toBe(JSON.stringify(decideSemantic({ matches, thresholds: DEFAULT_SEMANTIC_THRESHOLDS })))
  })
})

describe("sortSemanticMatches", () => {
  it("sorts by similarity desc then comparison then edition id", () => {
    const sorted = sortSemanticMatches([
      match({ editionId: 40, similarity: 0.7 }),
      match({ editionId: 41, similarity: 0.9 }),
      match({ comparison: "same-site", editionId: 42, similarity: 0.9 }),
    ])
    expect(sorted.map((candidate) => candidate.editionId)).toEqual([41, 42, 40])
  })

  it("breaks full ties on the input hash and keeps equal hashes equal", () => {
    const descendingFirst = sortSemanticMatches([
      match({ editionId: 50, inputHash: "f".repeat(64), similarity: 0.9 }),
      match({ editionId: 50, inputHash: "1".repeat(64), similarity: 0.9 }),
    ])
    const ascendingFirst = sortSemanticMatches([
      match({ editionId: 50, inputHash: "1".repeat(64), similarity: 0.9 }),
      match({ editionId: 50, inputHash: "f".repeat(64), similarity: 0.9 }),
    ])
    const expected = ["1", "f"]
    expect(descendingFirst.map((candidate) => candidate.inputHash[0])).toEqual(expected)
    expect(ascendingFirst.map((candidate) => candidate.inputHash[0])).toEqual(expected)
    const equalHashes = sortSemanticMatches([
      match({ editionId: 50, inputHash: "a".repeat(64), similarity: 0.9 }),
      match({ editionId: 50, inputHash: "a".repeat(64), similarity: 0.9 }),
    ])
    expect(equalHashes).toHaveLength(2)
  })
})

describe("decideSemantic escalation", () => {
  it("keeps blocked when a review-band match arrives afterwards", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.95 }), match({ editionId: 25, similarity: 0.86 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues.map((issue) => issue.code)).toEqual([
      "SEMANTIC_CROSS_DOMAIN_DUPLICATE",
      "SEMANTIC_CROSS_DOMAIN_REVIEW",
    ])
  })

  it("stays at review when several review-band matches arrive", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.86 }), match({ editionId: 26, similarity: 0.88 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("review-required")
  })

  it("rounds measured similarities before boundary comparison", () => {
    const decision = decideSemantic({
      matches: [match({ similarity: 0.9199996 })],
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.topMatches[0]?.similarity).toBe(0.92)
  })
})

import fc from "fast-check"
import { articlePageFixture } from "@geo/schema"
import { describe, expect, it } from "vitest"

import {
  QUALITY_SEVERITY,
  aggregateSeverities,
  runDeterministicRules,
  compareIssues,
  deterministicRuleIds,
  isBlockingSeverity,
  serializeIssues,
  sortIssues,
  type QualityIssue,
  type QualitySeverity,
} from "../src/index.js"

const severityArbitrary = fc.constantFrom(...QUALITY_SEVERITY)

const fieldArbitrary = fc.stringMatching(/^[a-z][a-z0-9.]{0,15}/)
const codeArbitrary = fc.stringMatching(/^[A-Z][A-Z_]{3,18}/)
const textArbitrary = fc.stringMatching(/^[a-z ]{1,24}/)

const issueArbitrary: fc.Arbitrary<QualityIssue> = fc
  .tuple(codeArbitrary, fieldArbitrary, textArbitrary, textArbitrary, severityArbitrary)
  .map(([code, field, message, recommendation, severity]) => ({
    code,
    location: { field },
    message,
    recommendation,
    severity,
  }))

describe("issue ordering determinism", () => {
  it("sorts identically for shuffled inputs and is idempotent", () => {
    const issuesArbitrary = fc.array(issueArbitrary, { maxLength: 40 })
    fc.assert(
      fc.property(issuesArbitrary, (issues) => {
        const once = sortIssues(issues)
        const twice = sortIssues(once)
        expect([...twice]).toEqual([...once])
        const shuffled = [...issues]
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(Math.random() * (index + 1))
          const held = shuffled[index]
          shuffled[index] = shuffled[swap]
          shuffled[swap] = held
        }
        expect([...sortIssues(shuffled)]).toEqual([...once])
      }),
      { numRuns: 200 },
    )
  })

  it("is a strict total order", () => {
    fc.assert(
      fc.property(issueArbitrary, issueArbitrary, issueArbitrary, (left, middle, right) => {
        expect(compareIssues(left, left)).toBe(0)
        const forward = compareIssues(left, right)
        const backward = compareIssues(right, left)
        expect(Math.sign(forward)).toBe(-Math.sign(backward))
        if (compareIssues(left, middle) < 0 && compareIssues(middle, right) < 0) {
          expect(compareIssues(left, right)).toBeLessThan(0)
        }
      }),
      { numRuns: 300 },
    )
  })

  it("orders primarily by severity weight descending", () => {
    const issues: QualityIssue[] = QUALITY_SEVERITY.map((severity, index) => ({
      code: `CODE_${String(index).padStart(2, "0")}`,
      location: { field: "f" },
      message: "m",
      recommendation: "r",
      severity,
    }))
    expect(sortIssues(issues).map((issue) => issue.severity)).toEqual([
      "critical",
      "high",
      "major",
      "minor",
      "info",
    ])
  })
})

describe("issue serialization determinism", () => {
  it("produces byte-identical output across repeated calls", () => {
    fc.assert(
      fc.property(fc.array(issueArbitrary, { maxLength: 30 }), (issues) => {
        expect(serializeIssues(issues)).toBe(serializeIssues(issues))
      }),
      { numRuns: 100 },
    )
  })

  it("round-trips the sorted list", () => {
    fc.assert(
      fc.property(fc.array(issueArbitrary, { maxLength: 30 }), (issues) => {
        const parsed = JSON.parse(serializeIssues(issues)) as QualityIssue[]
        expect(parsed).toEqual(sortIssues(issues) as unknown as QualityIssue[])
      }),
      { numRuns: 100 },
    )
  })
})

describe("severity aggregation", () => {
  it("counts every severity and derives blocking exactly", () => {
    fc.assert(
      fc.property(fc.array(severityArbitrary, { maxLength: 60 }), (severities) => {
        const issues = severities.map((severity, index) => ({
          code: `CODE_${index}`,
          location: { field: "f" },
          message: "m",
          recommendation: "r",
          severity: severity as QualitySeverity,
        }))
        const aggregate = aggregateSeverities(issues)
        const total = Object.values(aggregate.counts).reduce((sum, count) => sum + count, 0)
        expect(total).toBe(issues.length)
        expect(aggregate.blocking).toBe(issues.some((issue) => isBlockingSeverity(issue.severity)))
      }),
      { numRuns: 200 },
    )
  })

  it("blocks on high or critical and nothing below", () => {
    expect(aggregateSeverities([]).blocking).toBe(false)
    for (const severity of QUALITY_SEVERITY) {
      const issues = [
        {
          code: "X",
          location: { field: "f" },
          message: "m",
          recommendation: "r",
          severity,
        },
      ]
      expect(aggregateSeverities(issues).blocking).toBe(
        severity === "high" || severity === "critical",
      )
    }
  })
})

describe("issue comparator branch completion", () => {
  const baseIssue = (message: string): QualityIssue => ({
    code: "SAME_CODE",
    location: { field: "same.field" },
    message,
    recommendation: "same recommendation",
    severity: "major",
  })

  it("breaks message ties in both directions", () => {
    expect(compareIssues(baseIssue("alpha"), baseIssue("beta"))).toBe(-1)
    expect(compareIssues(baseIssue("beta"), baseIssue("alpha"))).toBe(1)
    expect(compareIssues(baseIssue("same"), baseIssue("same"))).toBe(0)
  })

  it("breaks location ties by index then id", () => {
    const issueAt = (
      blockIndex: number | undefined,
      blockId: string | undefined,
    ): QualityIssue => ({
      ...baseIssue("same"),
      location: {
        ...(blockId === undefined ? {} : { blockId }),
        ...(blockIndex === undefined ? {} : { blockIndex }),
        field: "same.field",
      },
    })
    expect(compareIssues(issueAt(0, undefined), issueAt(1, undefined))).toBe(-1)
    expect(compareIssues(issueAt(1, "a"), issueAt(1, "b"))).toBe(-1)
    expect(compareIssues(issueAt(undefined, "a"), issueAt(undefined, "b"))).toBe(-1)
    expect(compareIssues(issueAt(2, "a"), issueAt(1, "z"))).toBe(1)
  })

  it("marks critical severities as blocking", () => {
    expect(isBlockingSeverity("critical")).toBe(true)
    expect(isBlockingSeverity("high")).toBe(true)
    expect(isBlockingSeverity("info")).toBe(false)
  })

  it("serializes block identity fields when present and omits them when absent", () => {
    const withIdentity: QualityIssue[] = [
      {
        code: "A",
        location: { blockId: "image-map", blockIndex: 3, field: "body[3]" },
        message: "m",
        recommendation: "r",
        severity: "critical",
      },
      {
        code: "B",
        location: { field: "seo.title" },
        message: "m",
        recommendation: "r",
        severity: "info",
      },
    ]
    const parsed = JSON.parse(serializeIssues(withIdentity)) as QualityIssue[]
    expect(parsed[0]?.location).toEqual({
      blockId: "image-map",
      blockIndex: 3,
      field: "body[3]",
    })
    expect(parsed[1]?.location).toEqual({ field: "seo.title" })
  })
})

describe("rule dispatch surface", () => {
  it("exposes a stable, exhaustive rule id list", () => {
    expect([...deterministicRuleIds]).toEqual([
      "seoTitle",
      "canonical",
      "dates",
      "jsonLd",
      "blocks",
      "headings",
      "contentLength",
      "internalLinks",
      "citations",
    ])
  })

  it("returns identical results for identical inputs across repeated runs", () => {
    const runOnce = runHealthy()
    const runTwice = runHealthy()
    expect(serializeIssues(runOnce.issues)).toBe(serializeIssues(runTwice.issues))
    expect(runOnce.aggregate).toEqual(runTwice.aggregate)
  })
})

const runHealthy = () => runDeterministicRules({ document: articlePageFixture })

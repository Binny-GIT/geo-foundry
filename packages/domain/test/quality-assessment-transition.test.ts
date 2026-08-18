import { describe, expect, it } from "vitest"
import {
  QUALITY_ASSESSMENT_STATE,
  transitionQualityAssessment,
  type QualityAssessment,
  type QualityAssessmentState,
} from "../src/index.js"
import { assessmentId, clock, hash, ownership, serviceActor } from "./fixtures.js"

const evidence = {
  inputHash: hash,
  issues: [{ code: "SEO_TITLE", severity: "medium" }],
  modelId: "quality-model-1",
  promptVersion: "quality-v1",
  provider: "deterministic-fake",
  thresholdsHash: hash,
} as const

function assessment(state: QualityAssessmentState): QualityAssessment {
  return { audit: [], evidence, id: assessmentId, ownership, revision: 2, state }
}

describe("transitionQualityAssessment", () => {
  const states = Object.values(QUALITY_ASSESSMENT_STATE)
  const allowed = new Set(["pending:running", "running:passed", "running:failed", "running:error"])

  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "returns the specified result for $from -> $to",
    ({ from, to }) => {
      // Given
      const current = assessment(from)

      // When
      const result = transitionQualityAssessment(current, to, {
        actor: serviceActor,
        clock,
        expectedRevision: 2,
      })

      // Then
      expect(result.ok).toBe(allowed.has(`${from}:${to}`))
      if (result.ok) {
        expect(result.value.evidence).toStrictEqual(evidence)
      } else {
        expect(result.error.code).toBe("QUALITY_ASSESSMENT_TRANSITION_NOT_ALLOWED")
      }
    },
  )

  it("rejects a transition based on a stale revision", () => {
    // Given
    const pending = assessment("pending")

    // When
    const result = transitionQualityAssessment(pending, "running", {
      actor: serviceActor,
      clock,
      expectedRevision: 1,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
  })

  it("fails loudly for malformed target", () => {
    // Given
    const running = assessment("running")

    // When / Then
    expect(() =>
      Reflect.apply(transitionQualityAssessment, undefined, [
        running,
        "malformed",
        { actor: serviceActor, clock, expectedRevision: 2 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })

  it("fails loudly for malformed current state", () => {
    // Given
    const malformed = { ...assessment("pending"), state: "malformed" }

    // When / Then
    expect(() =>
      Reflect.apply(transitionQualityAssessment, undefined, [
        malformed,
        "running",
        { actor: serviceActor, clock, expectedRevision: 2 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})

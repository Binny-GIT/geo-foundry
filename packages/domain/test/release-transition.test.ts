import { describe, expect, it } from "vitest"
import {
  RELEASE_STATE,
  transitionRelease,
  type Release,
  type ReleaseState,
  type ReleaseTransitionContext,
} from "../src/index.js"
import { clock, hash, ownership, releaseId, serviceActor, userActor } from "./fixtures.js"

function release(state: ReleaseState): Release {
  return { audit: [], id: releaseId, manifestHash: hash, ownership, revision: 5, state }
}

function context(from: ReleaseState, to: ReleaseState): ReleaseTransitionContext {
  const publishes = from === "uploaded" && to === "current"
  const rollsBack = from === "current" && to === "rolled_back"
  return {
    actor: publishes || from === "current" ? userActor("publisher") : serviceActor,
    clock,
    expectedRevision: 5,
    manifestVerified: publishes,
    pointerCasMatched: publishes || rollsBack,
  }
}

describe("transitionRelease", () => {
  const states = Object.values(RELEASE_STATE)
  const allowed = new Set([
    "building:validated",
    "building:failed",
    "validated:uploaded",
    "validated:failed",
    "uploaded:current",
    "uploaded:failed",
    "current:superseded",
    "current:rolled_back",
  ])

  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "returns the specified result for $from -> $to",
    ({ from, to }) => {
      // Given
      const current = release(from)

      // When
      const result = transitionRelease(current, to, context(from, to))

      // Then
      expect(result.ok).toBe(allowed.has(`${from}:${to}`))
      if (!result.ok) {
        expect(result.error.code).toBe("RELEASE_TRANSITION_NOT_ALLOWED")
      }
    },
  )

  it.each([
    { manifestVerified: false, pointerCasMatched: true, code: "RELEASE_MANIFEST_NOT_VERIFIED" },
    { manifestVerified: true, pointerCasMatched: false, code: "RELEASE_POINTER_CAS_CONFLICT" },
  ] as const)("returns $code before making a release current", (guard) => {
    // Given
    const uploaded = release("uploaded")

    // When
    const result = transitionRelease(uploaded, "current", {
      actor: userActor("publisher"),
      clock,
      expectedRevision: 5,
      ...guard,
    })

    // Then
    expect(result).toMatchObject({ error: { code: guard.code }, ok: false })
    expect(uploaded.state).toBe("uploaded")
  })

  it("requires publisher authorization for pointer-changing transitions", () => {
    // Given
    const uploaded = release("uploaded")

    // When
    const result = transitionRelease(uploaded, "current", {
      actor: userActor("reviewer"),
      clock,
      expectedRevision: 5,
      manifestVerified: true,
      pointerCasMatched: true,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "RELEASE_PUBLISHER_REQUIRED" }, ok: false })
  })

  it("rejects rollback when current pointer CAS is stale", () => {
    // Given
    const current = release("current")

    // When
    const result = transitionRelease(current, "rolled_back", {
      actor: userActor("publisher"),
      clock,
      expectedRevision: 5,
      manifestVerified: true,
      pointerCasMatched: false,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "RELEASE_POINTER_CAS_CONFLICT" }, ok: false })
  })

  it("requires publisher authorization before rolling back a current release", () => {
    // Given
    const current = release("current")

    // When
    const result = transitionRelease(current, "rolled_back", {
      actor: userActor("reviewer"),
      clock,
      expectedRevision: 5,
      manifestVerified: true,
      pointerCasMatched: true,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "RELEASE_PUBLISHER_REQUIRED" }, ok: false })
  })

  it("requires publisher authorization before superseding a current release", () => {
    // Given
    const current = release("current")

    // When
    const result = transitionRelease(current, "superseded", {
      actor: userActor("reviewer"),
      clock,
      expectedRevision: 5,
      manifestVerified: true,
      pointerCasMatched: true,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "RELEASE_PUBLISHER_REQUIRED" }, ok: false })
  })

  it("rejects a transition based on a stale revision", () => {
    // Given
    const building = release("building")

    // When
    const result = transitionRelease(building, "validated", {
      actor: serviceActor,
      clock,
      expectedRevision: 4,
      manifestVerified: false,
      pointerCasMatched: false,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
  })

  it("fails loudly for malformed current state", () => {
    // Given
    const malformed = { ...release("building"), state: "malformed" }

    // When / Then
    expect(() =>
      Reflect.apply(transitionRelease, undefined, [
        malformed,
        "validated",
        context("building", "validated"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})

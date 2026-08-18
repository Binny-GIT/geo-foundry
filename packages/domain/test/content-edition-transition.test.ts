import { describe, expect, it } from "vitest"
import {
  CONTENT_EDITION_STATE,
  createDraftEditionFromPublished,
  parseEditionId,
  transitionContentEdition,
  type ContentEdition,
  type ContentEditionState,
  type ContentEditionTransitionContext,
} from "../src/index.js"
import {
  clock,
  contentId,
  editionId,
  ownership,
  serviceActor,
  unwrapResult,
  userActor,
} from "./fixtures.js"

function edition(state: ContentEditionState): ContentEdition {
  return { audit: [], contentId, id: editionId, ownership, revision: 7, state, version: 2 }
}

function context(
  from: ContentEditionState,
  to: ContentEditionState,
): ContentEditionTransitionContext {
  const actor =
    from === "review" && to === "approved"
      ? userActor("reviewer")
      : to === "published" || to === "archived"
        ? userActor("publisher")
        : serviceActor
  return {
    actor,
    clock,
    expectedRevision: 7,
    qualityAssessmentState: from === "approved" && to === "compiled" ? "passed" : null,
  }
}

describe("transitionContentEdition", () => {
  const states = Object.values(CONTENT_EDITION_STATE)
  const allowed = new Set([
    "draft:generating",
    "generating:draft",
    "generating:review",
    "review:approved",
    "approved:compiled",
    "compiled:published",
    "published:archived",
  ])

  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "returns the specified result for $from -> $to",
    ({ from, to }) => {
      // Given
      const current = edition(from)

      // When
      const result = transitionContentEdition(current, to, context(from, to))

      // Then
      expect(result.ok).toBe(allowed.has(`${from}:${to}`))
      if (!result.ok) {
        expect(result.error.code).toBe("CONTENT_EDITION_TRANSITION_NOT_ALLOWED")
      }
    },
  )

  it.each([
    {
      actor: userActor("editor"),
      code: "CONTENT_EDITION_REVIEWER_REQUIRED",
      from: "review",
      to: "approved",
    },
    {
      actor: userActor("reviewer"),
      code: "CONTENT_EDITION_PUBLISHER_REQUIRED",
      from: "compiled",
      to: "published",
    },
    {
      actor: userActor("reviewer"),
      code: "CONTENT_EDITION_PUBLISHER_REQUIRED",
      from: "published",
      to: "archived",
    },
  ] as const)("returns $code when role guard fails", ({ actor, code, from, to }) => {
    // Given
    const current = edition(from)

    // When
    const result = transitionContentEdition(current, to, {
      actor,
      clock,
      expectedRevision: 7,
      qualityAssessmentState: null,
    })

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it("fails closed when compilation has no passed assessment", () => {
    // Given
    const approved = edition("approved")

    // When
    const result = transitionContentEdition(approved, "compiled", {
      actor: serviceActor,
      clock,
      expectedRevision: 7,
      qualityAssessmentState: "error",
    })

    // Then
    expect(result).toMatchObject({
      error: { code: "CONTENT_EDITION_QUALITY_NOT_PASSED" },
      ok: false,
    })
  })

  it("creates a new draft version instead of reopening a published edition", () => {
    // Given
    const published = edition("published")
    const nextId = unwrapResult(parseEditionId("edition-2"))

    // When
    const result = createDraftEditionFromPublished(published, nextId, {
      actor: userActor("editor"),
      clock,
      expectedRevision: 7,
    })

    // Then
    expect(result).toMatchObject({
      ok: true,
      value: { id: nextId, revision: 0, state: "draft", version: 3 },
    })
    expect(published.state).toBe("published")
  })

  it("rejects draft creation from an unpublished edition", () => {
    // Given
    const draft = edition("draft")

    // When
    const result = createDraftEditionFromPublished(
      draft,
      unwrapResult(parseEditionId("edition-2")),
      { actor: userActor("editor"), clock, expectedRevision: 7 },
    )

    // Then
    expect(result).toMatchObject({
      error: { code: "CONTENT_EDITION_SOURCE_NOT_PUBLISHED" },
      ok: false,
    })
  })

  it("rejects transition and draft derivation based on stale revisions", () => {
    // Given
    const draft = edition("draft")
    const published = edition("published")
    const stale = { actor: serviceActor, clock, expectedRevision: 6 }

    // When
    const transition = transitionContentEdition(draft, "generating", {
      ...stale,
      qualityAssessmentState: null,
    })
    const derivation = createDraftEditionFromPublished(
      published,
      unwrapResult(parseEditionId("edition-2")),
      stale,
    )

    // Then
    expect(transition).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
    expect(derivation).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
  })

  it("requires editor authorization to derive a draft", () => {
    // Given
    const published = edition("published")

    // When
    const result = createDraftEditionFromPublished(
      published,
      unwrapResult(parseEditionId("edition-2")),
      { actor: userActor("reviewer"), clock, expectedRevision: 7 },
    )

    // Then
    expect(result).toMatchObject({
      error: { code: "CONTENT_EDITION_EDITOR_REQUIRED" },
      ok: false,
    })
  })

  it.each(["draft", "generating"] as const)(
    "fails loudly for malformed target from %s",
    (state) => {
      // Given
      const current = edition(state)

      // When / Then
      expect(() =>
        Reflect.apply(transitionContentEdition, undefined, [
          current,
          "malformed",
          { ...context(state, state), qualityAssessmentState: null },
        ]),
      ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
    },
  )

  it("fails loudly for malformed current state", () => {
    // Given
    const malformed = { ...edition("draft"), state: "malformed" }

    // When / Then
    expect(() =>
      Reflect.apply(transitionContentEdition, undefined, [
        malformed,
        "generating",
        { ...context("draft", "generating"), qualityAssessmentState: null },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})

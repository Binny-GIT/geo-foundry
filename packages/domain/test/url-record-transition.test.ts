import { describe, expect, it } from "vitest"
import {
  URL_RECORD_STATE,
  transitionUrlRecord,
  type UrlRecord,
  type UrlRecordState,
  type UrlRecordTransitionContext,
} from "../src/index.js"
import {
  clock,
  contentId,
  otherSiteId,
  ownership,
  serviceActor,
  siteId,
  urlId,
} from "./fixtures.js"

function urlRecord(state: UrlRecordState): UrlRecord {
  return {
    audit: [],
    contentId,
    id: urlId,
    locale: "en",
    ownership,
    pathname: "/articles/example",
    revision: 4,
    state,
  }
}

function context(from: UrlRecordState, to: UrlRecordState): UrlRecordTransitionContext {
  return {
    actor: serviceActor,
    clock,
    expectedRevision: 4,
    redirectTarget:
      from === "active" && to === "redirected" ? { siteId, state: "active", urlId } : null,
  }
}

describe("transitionUrlRecord", () => {
  const states = Object.values(URL_RECORD_STATE)
  const allowed = new Set(["reserved:active", "active:redirected", "active:gone"])

  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "returns the specified result for $from -> $to",
    ({ from, to }) => {
      // Given
      const current = urlRecord(from)

      // When
      const result = transitionUrlRecord(current, to, context(from, to))

      // Then
      expect(result.ok).toBe(allowed.has(`${from}:${to}`))
      if (!result.ok) {
        expect(result.error.code).toBe("URL_RECORD_TRANSITION_NOT_ALLOWED")
      }
    },
  )

  it.each([
    { code: "URL_REDIRECT_TARGET_NOT_ACTIVE", redirectTarget: null },
    {
      code: "URL_REDIRECT_TARGET_NOT_ACTIVE",
      redirectTarget: { siteId, state: "redirected", urlId },
    },
    {
      code: "URL_REDIRECT_CROSS_SITE",
      redirectTarget: { siteId: otherSiteId, state: "active", urlId },
    },
  ] as const)("returns $code for an invalid redirect target", ({ code, redirectTarget }) => {
    // Given
    const active = urlRecord("active")

    // When
    const result = transitionUrlRecord(active, "redirected", {
      actor: serviceActor,
      clock,
      expectedRevision: 4,
      redirectTarget,
    })

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it("does not reactivate a redirected URL", () => {
    // Given
    const redirected = urlRecord("redirected")

    // When
    const result = transitionUrlRecord(redirected, "active", context("redirected", "active"))

    // Then
    expect(result).toMatchObject({
      error: { code: "URL_RECORD_TRANSITION_NOT_ALLOWED" },
      ok: false,
    })
  })

  it("rejects a transition based on a stale revision", () => {
    // Given
    const reserved = urlRecord("reserved")

    // When
    const result = transitionUrlRecord(reserved, "active", {
      actor: serviceActor,
      clock,
      expectedRevision: 3,
      redirectTarget: null,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
  })

  it("fails loudly for malformed current state", () => {
    // Given
    const malformed = { ...urlRecord("reserved"), state: "malformed" }

    // When / Then
    expect(() =>
      Reflect.apply(transitionUrlRecord, undefined, [
        malformed,
        "active",
        context("reserved", "active"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})

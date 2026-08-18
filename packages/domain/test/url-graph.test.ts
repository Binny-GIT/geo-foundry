import { describe, expect, it } from "vitest"
import {
  parseUrlId,
  publishUrl,
  renameUrl,
  reserveUrl,
  validateRedirectGraph,
} from "../src/index.js"
import {
  emptyUrlRegistry,
  firstUrlId,
  otherSiteOwnership,
  otherTenantOwnership,
  secondUrlId,
  thirdUrlId,
  urlContentId,
  urlOwnership,
  unwrapUrlResult,
} from "./url-fixtures.js"

function activePair() {
  const firstReserved = unwrapUrlResult(
    reserveUrl(emptyUrlRegistry(), {
      contentId: urlContentId,
      expectedRevision: 0,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "/first",
      urlId: firstUrlId,
    }),
  )
  const firstPublished = unwrapUrlResult(
    publishUrl(firstReserved.registry, {
      expectedRevision: 1,
      hostname: "site-a.test",
      urlId: firstUrlId,
    }),
  )
  const secondReserved = unwrapUrlResult(
    reserveUrl(firstPublished.registry, {
      contentId: urlContentId,
      expectedRevision: 2,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "/second",
      urlId: secondUrlId,
    }),
  )
  return unwrapUrlResult(
    publishUrl(secondReserved.registry, {
      expectedRevision: 3,
      hostname: "site-a.test",
      urlId: secondUrlId,
    }),
  )
}

function renamedGraph() {
  const pair = activePair()
  return unwrapUrlResult(
    renameUrl(pair.registry, {
      expectedRevision: 4,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/third",
      sourceUrlId: firstUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: thirdUrlId,
    }),
  )
}

describe("redirect graph", () => {
  it.each([
    { code: "URL_REDIRECT_LOOP", target: "self" },
    { code: "URL_REDIRECT_CHAIN", target: "chain" },
  ] as const)("rejects redirect $target with $code", ({ code, target }) => {
    // Given
    const renamed = renamedGraph()
    const invalidTarget = Object.freeze({
      ...renamed.active,
      state: "redirected" as const,
      statusCode: 301 as const,
      targetUrlId: target === "self" ? thirdUrlId : secondUrlId,
    })
    const invalidRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze(
        renamed.registry.routes.map((route) =>
          route.id.value === thirdUrlId.value ? invalidTarget : route,
        ),
      ),
    })

    // When
    const result = validateRedirectGraph(invalidRegistry)

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it("accepts a valid one-hop graph", () => {
    // Given
    const renamed = renamedGraph()

    // When
    const result = validateRedirectGraph(renamed.registry)

    // Then
    expect(result).toMatchObject({ ok: true })
  })

  it("rejects duplicate identifiers and normalized keys", () => {
    // Given
    const pair = activePair()
    const first = pair.registry.routes[0]
    const second = pair.registry.routes[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) {
      return
    }
    const duplicateIdRegistry = Object.freeze({
      ...pair.registry,
      routes: Object.freeze([first, Object.freeze({ ...second, id: first.id })]),
    })
    const duplicateKeyRegistry = Object.freeze({
      ...pair.registry,
      routes: Object.freeze([first, Object.freeze({ ...second, key: first.key })]),
    })

    // When
    const duplicateId = validateRedirectGraph(duplicateIdRegistry)
    const duplicateKey = validateRedirectGraph(duplicateKeyRegistry)

    // Then
    expect(duplicateId).toMatchObject({ error: { code: "URL_ID_COLLISION" }, ok: false })
    expect(duplicateKey).toMatchObject({
      error: { code: "URL_UNIQUE_KEY_COLLISION" },
      ok: false,
    })
  })

  it.each([
    { code: "URL_REDIRECT_CROSS_SITE", ownership: otherSiteOwnership },
    { code: "URL_REDIRECT_CROSS_TENANT", ownership: otherTenantOwnership },
  ])("rejects graph ownership with $code", ({ code, ownership }) => {
    // Given
    const renamed = renamedGraph()
    const invalidTarget = Object.freeze({ ...renamed.active, ownership })
    const invalidRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze(
        renamed.registry.routes.map((route) =>
          route.id.value === invalidTarget.id.value ? invalidTarget : route,
        ),
      ),
    })

    // When
    const result = validateRedirectGraph(invalidRegistry)

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it.each(["reserved", "gone"] as const)("rejects a $state redirect target", (state) => {
    // Given
    const renamed = renamedGraph()
    const invalidTarget = Object.freeze({ ...renamed.active, state })
    const invalidRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze(
        renamed.registry.routes.map((route) =>
          route.id.value === invalidTarget.id.value ? invalidTarget : route,
        ),
      ),
    })

    // When
    const result = validateRedirectGraph(invalidRegistry)

    // Then
    expect(result).toMatchObject({
      error: { code: "URL_REDIRECT_TARGET_NOT_ACTIVE" },
      ok: false,
    })
  })

  it("rejects a missing redirect target", () => {
    // Given
    const renamed = renamedGraph()
    const missingId = unwrapUrlResult(parseUrlId("url-missing"))
    const invalidRedirect = Object.freeze({ ...renamed.redirect, targetUrlId: missingId })
    const invalidRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze(
        renamed.registry.routes.map((route) =>
          route.id.value === invalidRedirect.id.value ? invalidRedirect : route,
        ),
      ),
    })

    // When
    const result = validateRedirectGraph(invalidRegistry)

    // Then
    expect(result).toMatchObject({
      error: { code: "URL_REDIRECT_TARGET_NOT_ACTIVE" },
      ok: false,
    })
  })

  it("throws a typed unreachable error for future graph variants", () => {
    // Given
    const renamed = renamedGraph()
    const futureTarget = Object.freeze({ ...renamed.active, state: "future" })
    const futureTargetRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze(
        renamed.registry.routes.map((route) =>
          route.id.value === futureTarget.id.value ? futureTarget : route,
        ),
      ),
    })
    const futureOuterRegistry = Object.freeze({
      ...renamed.registry,
      routes: Object.freeze([futureTarget]),
    })

    // When / Then
    expect(() => Reflect.apply(validateRedirectGraph, null, [futureTargetRegistry])).toThrowError(
      expect.objectContaining({ code: "UNREACHABLE_STATE" }),
    )
    expect(() => Reflect.apply(validateRedirectGraph, null, [futureOuterRegistry])).toThrowError(
      expect.objectContaining({ code: "UNREACHABLE_STATE" }),
    )
  })
})

import { describe, expect, it } from "vitest"
import { markUrlGone, publishUrl, renameUrl, reserveUrl } from "../src/index.js"
import {
  emptyUrlRegistry,
  firstUrlId,
  secondUrlId,
  thirdUrlId,
  unwrapUrlResult,
  urlContentId,
  urlOwnership,
} from "./url-fixtures.js"

function reservedFixture() {
  return unwrapUrlResult(
    reserveUrl(emptyUrlRegistry(), {
      contentId: urlContentId,
      expectedRevision: 0,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "/first",
      urlId: firstUrlId,
    }),
  )
}

function publishedFixture() {
  const reserved = reservedFixture()
  return unwrapUrlResult(
    publishUrl(reserved.registry, {
      expectedRevision: 1,
      hostname: "site-a.test",
      urlId: firstUrlId,
    }),
  )
}

describe("url transition failures", () => {
  it("rejects renaming an active target with an inbound redirect atomically", () => {
    // Given
    const published = publishedFixture()
    const renamed = unwrapUrlResult(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-a.test",
        locale: "en-US",
        pathname: "/second",
        sourceUrlId: firstUrlId,
        targetOwnership: urlOwnership,
        targetUrlId: secondUrlId,
      }),
    )
    const registryValueBefore = Object.freeze({
      redirectCount: renamed.registry.routes.filter((route) => route.state === "redirected").length,
      revision: renamed.registry.revision,
      routeCount: renamed.registry.routes.length,
    })
    const registryBytesBefore = JSON.stringify(renamed.registry)

    // When
    const result = renameUrl(renamed.registry, {
      expectedRevision: 3,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/third",
      sourceUrlId: secondUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: thirdUrlId,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "URL_REDIRECT_CHAIN" }, ok: false })
    expect({
      redirectCount: renamed.registry.routes.filter((route) => route.state === "redirected").length,
      revision: renamed.registry.revision,
      routeCount: renamed.registry.routes.length,
    }).toStrictEqual(registryValueBefore)
    expect(JSON.stringify(renamed.registry)).toBe(registryBytesBefore)
    expect(renamed.registry.routes.filter((route) => route.state === "redirected")).toHaveLength(1)
  })

  it("rejects rename revision, lookup, identifier, and chain failures", () => {
    // Given
    const published = publishedFixture()
    const renamed = unwrapUrlResult(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-a.test",
        locale: "en-US",
        pathname: "/second",
        sourceUrlId: firstUrlId,
        targetOwnership: urlOwnership,
        targetUrlId: secondUrlId,
      }),
    )

    // When
    const stale = renameUrl(published.registry, {
      expectedRevision: 1,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/other",
      sourceUrlId: firstUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: thirdUrlId,
    })
    const missing = renameUrl(emptyUrlRegistry(), {
      expectedRevision: 0,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/other",
      sourceUrlId: thirdUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: secondUrlId,
    })
    const duplicateId = renameUrl(published.registry, {
      expectedRevision: 2,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/other",
      sourceUrlId: firstUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: firstUrlId,
    })
    const chain = renameUrl(renamed.registry, {
      expectedRevision: 3,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/third",
      sourceUrlId: firstUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: thirdUrlId,
    })

    // Then
    expect(stale).toMatchObject({ error: { code: "URL_REGISTRY_REVISION_CONFLICT" }, ok: false })
    expect(missing).toMatchObject({ error: { code: "URL_RECORD_NOT_FOUND" }, ok: false })
    expect(duplicateId).toMatchObject({ error: { code: "URL_ID_COLLISION" }, ok: false })
    expect(chain).toMatchObject({ error: { code: "URL_REDIRECT_CHAIN" }, ok: false })
  })

  it.each([
    { code: "URL_INVALID_LOCALE", hostname: "site-a.test", locale: "bad_locale", pathname: "/x" },
    { code: "URL_INVALID_PATHNAME", hostname: "site-a.test", locale: "en-US", pathname: "x" },
    {
      code: "URL_RESERVED_ROUTE_COLLISION",
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/admin",
    },
    {
      code: "URL_UNIQUE_KEY_COLLISION",
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/first",
    },
    { code: "URL_INVALID_HOSTNAME", hostname: "bad host", locale: "en-US", pathname: "/x" },
  ])("rejects rename boundary with $code", ({ code, hostname, locale, pathname }) => {
    // Given
    const published = publishedFixture()

    // When
    const result = renameUrl(published.registry, {
      expectedRevision: 2,
      hostname,
      locale,
      pathname,
      sourceUrlId: firstUrlId,
      targetOwnership: urlOwnership,
      targetUrlId: secondUrlId,
    })

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it("rejects gone revision, lookup, and non-active states", () => {
    // Given
    const reserved = reservedFixture()
    const published = publishedFixture()
    const gone = unwrapUrlResult(
      markUrlGone(published.registry, { expectedRevision: 2, urlId: firstUrlId }),
    )

    // When
    const stale = markUrlGone(published.registry, { expectedRevision: 1, urlId: firstUrlId })
    const missing = markUrlGone(emptyUrlRegistry(), { expectedRevision: 0, urlId: thirdUrlId })
    const draft = markUrlGone(reserved.registry, { expectedRevision: 1, urlId: firstUrlId })
    const removed = markUrlGone(gone.registry, { expectedRevision: 3, urlId: firstUrlId })

    // Then
    expect(stale).toMatchObject({ error: { code: "URL_REGISTRY_REVISION_CONFLICT" }, ok: false })
    expect(missing).toMatchObject({ error: { code: "URL_RECORD_NOT_FOUND" }, ok: false })
    expect(draft).toMatchObject({ error: { code: "URL_RECORD_NOT_ACTIVE" }, ok: false })
    expect(removed).toMatchObject({ error: { code: "URL_RECORD_NOT_ACTIVE" }, ok: false })
  })
})

import { describe, expect, it } from "vitest"
import {
  createUrlRegistry,
  markUrlGone,
  publishUrl,
  renameUrl,
  reserveUrl,
  retainActiveUrlForContentUpdate,
} from "../src/index.js"
import {
  emptyUrlRegistry,
  firstUrlId,
  secondUrlId,
  thirdUrlId,
  urlContentId,
  urlOwnership,
  unwrapUrlResult,
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

describe("url registry failures", () => {
  it("normalizes, sorts, and deduplicates reserved routes", () => {
    // Given / When
    const registry = unwrapUrlResult(
      createUrlRegistry({ reservedPathnames: ["/z/", "/a", "//a//"] }),
    )

    // Then
    expect(registry.reservedPathnames.map((pathname) => pathname.value)).toEqual(["/a", "/z"])
  })

  it("rejects an invalid reserved route", () => {
    // Given / When
    const result = createUrlRegistry({ reservedPathnames: ["relative"] })

    // Then
    expect(result).toMatchObject({ error: { code: "URL_INVALID_PATHNAME" }, ok: false })
  })

  it.each([
    { code: "URL_INVALID_LOCALE", locale: "bad_locale", pathname: "/valid" },
    { code: "URL_INVALID_PATHNAME", locale: "en-US", pathname: "relative" },
  ])("rejects reservation boundary with $code", ({ code, locale, pathname }) => {
    // Given / When
    const result = reserveUrl(emptyUrlRegistry(), {
      contentId: urlContentId,
      expectedRevision: 0,
      locale,
      ownership: urlOwnership,
      pathname,
      urlId: firstUrlId,
    })

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it("rejects duplicate identifiers and normalized keys", () => {
    // Given
    const first = reservedFixture()

    // When
    const duplicateId = reserveUrl(first.registry, {
      contentId: urlContentId,
      expectedRevision: 1,
      locale: "fr-FR",
      ownership: urlOwnership,
      pathname: "/other",
      urlId: firstUrlId,
    })
    const duplicateKey = reserveUrl(first.registry, {
      contentId: urlContentId,
      expectedRevision: 1,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "//first/",
      urlId: secondUrlId,
    })

    // Then
    expect(duplicateId).toMatchObject({ error: { code: "URL_ID_COLLISION" }, ok: false })
    expect(duplicateKey).toMatchObject({
      error: { code: "URL_UNIQUE_KEY_COLLISION" },
      ok: false,
    })
  })

  it("rejects publish revision, lookup, hostname, and state failures", () => {
    // Given
    const reserved = reservedFixture()
    const published = publishedFixture()

    // When
    const stale = publishUrl(reserved.registry, {
      expectedRevision: 0,
      hostname: "site-a.test",
      urlId: firstUrlId,
    })
    const missing = publishUrl(emptyUrlRegistry(), {
      expectedRevision: 0,
      hostname: "site-a.test",
      urlId: thirdUrlId,
    })
    const invalidHost = publishUrl(reserved.registry, {
      expectedRevision: 1,
      hostname: "bad host",
      urlId: firstUrlId,
    })
    const active = publishUrl(published.registry, {
      expectedRevision: 2,
      hostname: "site-a.test",
      urlId: firstUrlId,
    })

    // Then
    expect(stale).toMatchObject({ error: { code: "URL_REGISTRY_REVISION_CONFLICT" }, ok: false })
    expect(missing).toMatchObject({ error: { code: "URL_RECORD_NOT_FOUND" }, ok: false })
    expect(invalidHost).toMatchObject({ error: { code: "URL_INVALID_HOSTNAME" }, ok: false })
    expect(active).toMatchObject({ error: { code: "URL_RECORD_NOT_RESERVED" }, ok: false })
  })

  it("rejects retention for missing and non-active routes", () => {
    // Given
    const reserved = reservedFixture()
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
    const gone = unwrapUrlResult(
      markUrlGone(published.registry, { expectedRevision: 2, urlId: firstUrlId }),
    )

    // When
    const missing = retainActiveUrlForContentUpdate(emptyUrlRegistry(), { urlId: thirdUrlId })
    const draft = retainActiveUrlForContentUpdate(reserved.registry, { urlId: firstUrlId })
    const redirect = retainActiveUrlForContentUpdate(renamed.registry, { urlId: firstUrlId })
    const removed = retainActiveUrlForContentUpdate(gone.registry, { urlId: firstUrlId })

    // Then
    expect(missing).toMatchObject({ error: { code: "URL_RECORD_NOT_FOUND" }, ok: false })
    for (const result of [draft, redirect, removed]) {
      expect(result).toMatchObject({ error: { code: "URL_RECORD_NOT_ACTIVE" }, ok: false })
    }
  })
})

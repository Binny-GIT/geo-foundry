import { describe, expect, it } from "vitest"
import {
  markUrlGone,
  publishUrl,
  renameUrl,
  requireSitemapEligible,
  reserveUrl,
  retainActiveUrlForContentUpdate,
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

describe("url lifecycle", () => {
  it("reserves, publishes, retains, renames once, and marks gone immutably", () => {
    // Given
    const empty = emptyUrlRegistry()
    const reserved = unwrapUrlResult(
      reserveUrl(empty, {
        contentId: urlContentId,
        expectedRevision: 0,
        locale: "en-US",
        ownership: urlOwnership,
        pathname: "/guides/geo-foundry",
        urlId: firstUrlId,
      }),
    )
    const published = unwrapUrlResult(
      publishUrl(reserved.registry, {
        expectedRevision: 1,
        hostname: "site-a.test",
        urlId: firstUrlId,
      }),
    )

    // When
    const retained = unwrapUrlResult(
      retainActiveUrlForContentUpdate(published.registry, { urlId: firstUrlId }),
    )
    const renamed = unwrapUrlResult(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-a.test",
        locale: "en-US",
        pathname: "/guides/geo-foundry-platform",
        sourceUrlId: firstUrlId,
        targetOwnership: urlOwnership,
        targetUrlId: secondUrlId,
      }),
    )
    const sitemap = requireSitemapEligible(renamed.active)
    const gone = unwrapUrlResult(
      markUrlGone(renamed.registry, { expectedRevision: 3, urlId: secondUrlId }),
    )

    // Then
    expect(retained.pathname.value).toBe("/guides/geo-foundry")
    expect(retained.canonicalUrl.value).toBe("https://site-a.test/en-US/guides/geo-foundry")
    expect(renamed.redirect).toMatchObject({ state: "redirected", statusCode: 301 })
    expect(renamed.registry.routes.filter((route) => route.state === "redirected")).toHaveLength(1)
    expect(sitemap).toMatchObject({ ok: true })
    expect(gone.gone.state).toBe("gone")
    expect(published.registry.revision).toBe(2)
    expect(gone.registry.revision).toBe(4)
    expect(Object.isFrozen(gone.registry.routes)).toBe(true)
  })

  it("rejects a reserved route and a concurrent normalized collision", () => {
    // Given
    const empty = emptyUrlRegistry()
    const first = unwrapUrlResult(
      reserveUrl(empty, {
        contentId: urlContentId,
        expectedRevision: 0,
        locale: "en-US",
        ownership: urlOwnership,
        pathname: "/guides/geo-foundry",
        urlId: firstUrlId,
      }),
    )

    // When
    const reservedCollision = reserveUrl(empty, {
      contentId: urlContentId,
      expectedRevision: 0,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "/admin/",
      urlId: secondUrlId,
    })
    const concurrentCollision = reserveUrl(first.registry, {
      contentId: urlContentId,
      expectedRevision: 0,
      locale: "en-US",
      ownership: urlOwnership,
      pathname: "/guides/geo-foundry",
      urlId: thirdUrlId,
    })

    // Then
    expect(reservedCollision).toMatchObject({
      error: { code: "URL_RESERVED_ROUTE_COLLISION" },
      ok: false,
    })
    expect(concurrentCollision).toMatchObject({
      error: { code: "URL_REGISTRY_REVISION_CONFLICT" },
      ok: false,
    })
  })

  it.each([
    { code: "URL_REDIRECT_CROSS_SITE", ownership: otherSiteOwnership },
    { code: "URL_REDIRECT_CROSS_TENANT", ownership: otherTenantOwnership },
  ])("rejects rename ownership with $code", ({ code, ownership }) => {
    // Given
    const reserved = unwrapUrlResult(
      reserveUrl(emptyUrlRegistry(), {
        contentId: urlContentId,
        expectedRevision: 0,
        locale: "en-US",
        ownership: urlOwnership,
        pathname: "/guides/geo-foundry",
        urlId: firstUrlId,
      }),
    )
    const published = unwrapUrlResult(
      publishUrl(reserved.registry, {
        expectedRevision: 1,
        hostname: "site-a.test",
        urlId: firstUrlId,
      }),
    )

    // When
    const result = renameUrl(published.registry, {
      expectedRevision: 2,
      hostname: "site-a.test",
      locale: "en-US",
      pathname: "/guides/renamed",
      sourceUrlId: firstUrlId,
      targetOwnership: ownership,
      targetUrlId: secondUrlId,
    })

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })

  it.each([
    { code: "URL_SITEMAP_DRAFT_INELIGIBLE", state: "reserved" },
    { code: "URL_SITEMAP_REDIRECT_INELIGIBLE", state: "redirected" },
    { code: "URL_SITEMAP_GONE_INELIGIBLE", state: "gone" },
  ] as const)("rejects $state sitemap inclusion", ({ code, state }) => {
    // Given
    const reserved = unwrapUrlResult(
      reserveUrl(emptyUrlRegistry(), {
        contentId: urlContentId,
        expectedRevision: 0,
        locale: "en-US",
        ownership: urlOwnership,
        pathname: "/guides/geo-foundry",
        urlId: firstUrlId,
      }),
    )
    const published = unwrapUrlResult(
      publishUrl(reserved.registry, {
        expectedRevision: 1,
        hostname: "site-a.test",
        urlId: firstUrlId,
      }),
    )
    const renamed = unwrapUrlResult(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-a.test",
        locale: "en-US",
        pathname: "/guides/renamed",
        sourceUrlId: firstUrlId,
        targetOwnership: urlOwnership,
        targetUrlId: secondUrlId,
      }),
    )
    const gone = unwrapUrlResult(
      markUrlGone(published.registry, { expectedRevision: 2, urlId: firstUrlId }),
    )
    const route =
      state === "reserved"
        ? reserved.reserved
        : state === "redirected"
          ? renamed.redirect
          : gone.gone

    // When
    const result = requireSitemapEligible(route)

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })
})

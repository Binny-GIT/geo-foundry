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
  secondUrlId,
  urlContentId,
  urlOwnership,
  unwrapUrlResult,
} from "./url-fixtures.js"

describe("url exhaustive variants", () => {
  it("throws typed unreachable errors for future lifecycle and sitemap variants", () => {
    // Given
    const reserved = unwrapUrlResult(
      reserveUrl(emptyUrlRegistry(), {
        contentId: urlContentId,
        expectedRevision: 0,
        locale: "en-US",
        ownership: urlOwnership,
        pathname: "/future",
        urlId: firstUrlId,
      }),
    )
    const futureRoute = Object.freeze({ ...reserved.reserved, state: "future" })
    const futureRegistry = Object.freeze({
      ...reserved.registry,
      routes: Object.freeze([futureRoute]),
    })

    // When / Then
    expect(() =>
      Reflect.apply(publishUrl, null, [
        futureRegistry,
        { expectedRevision: 1, hostname: "site-a.test", urlId: firstUrlId },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
    expect(() =>
      Reflect.apply(retainActiveUrlForContentUpdate, null, [futureRegistry, { urlId: firstUrlId }]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
    expect(() =>
      Reflect.apply(renameUrl, null, [
        futureRegistry,
        {
          expectedRevision: 1,
          hostname: "site-a.test",
          locale: "en-US",
          pathname: "/renamed",
          sourceUrlId: firstUrlId,
          targetOwnership: urlOwnership,
          targetUrlId: secondUrlId,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
    expect(() =>
      Reflect.apply(markUrlGone, null, [
        futureRegistry,
        { expectedRevision: 1, urlId: firstUrlId },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
    expect(() => Reflect.apply(requireSitemapEligible, null, [futureRoute])).toThrowError(
      expect.objectContaining({ code: "UNREACHABLE_STATE" }),
    )
  })
})

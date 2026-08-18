import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  normalizeHostname,
  normalizeLocale,
  normalizePathname,
  urlUniqueKey,
} from "../src/index.js"
import { urlSiteId, unwrapUrlResult } from "./url-fixtures.js"

describe("url normalization", () => {
  it("is idempotent for Unicode and percent encoding", () => {
    // Given
    const first = unwrapUrlResult(normalizePathname("//Guides/Cafe\u0301/%7eintro/"))

    // When
    const second = unwrapUrlResult(normalizePathname(first.value))

    // Then
    expect(first.value).toBe("/Guides/Caf%C3%A9/~intro")
    expect(second).toEqual(first)
  })

  it("normalizes hostname, locale, and tuple keys deterministically", () => {
    // Given
    const hostname = unwrapUrlResult(normalizeHostname("B\u00dcCHER.Example"))
    const locale = unwrapUrlResult(normalizeLocale("EN-us"))
    const pathname = unwrapUrlResult(normalizePathname("/Guides/Geo"))

    // When
    const first = urlUniqueKey({ locale, pathname, siteId: urlSiteId })
    const second = urlUniqueKey({ locale, pathname, siteId: urlSiteId })

    // Then
    expect(hostname.value).toBe("xn--bcher-kva.example")
    expect(locale.value).toBe("en-US")
    expect(second).toEqual(first)
  })

  it("keeps pathname normalization idempotent for generated segment lists", () => {
    // Given / When / Then
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9 _~\u00E9]*$/u), { maxLength: 6 }),
        (segments) => {
          const input = `//${segments.map((segment) => encodeURIComponent(segment)).join("//")}/`
          const first = normalizePathname(input)
          expect(first.ok).toBe(true)
          if (!first.ok) {
            return
          }
          expect(normalizePathname(first.value.value)).toEqual(first)
        },
      ),
      { numRuns: 200 },
    )
  })

  it("keeps distinct normalized tuples unique", () => {
    // Given / When / Then
    fc.assert(
      fc.property(
        fc.tuple(fc.constantFrom("en-US", "fr-FR"), fc.stringMatching(/^[a-z0-9-]{1,20}$/u)),
        fc.tuple(fc.constantFrom("en-US", "fr-FR"), fc.stringMatching(/^[a-z0-9-]{1,20}$/u)),
        ([firstLocaleInput, firstSegment], [secondLocaleInput, secondSegment]) => {
          const firstLocale = unwrapUrlResult(normalizeLocale(firstLocaleInput))
          const secondLocale = unwrapUrlResult(normalizeLocale(secondLocaleInput))
          const firstPathname = unwrapUrlResult(normalizePathname(`/${firstSegment}`))
          const secondPathname = unwrapUrlResult(normalizePathname(`/${secondSegment}`))
          const first = urlUniqueKey({
            locale: firstLocale,
            pathname: firstPathname,
            siteId: urlSiteId,
          })
          const second = urlUniqueKey({
            locale: secondLocale,
            pathname: secondPathname,
            siteId: urlSiteId,
          })
          const sameTuple =
            firstLocale.value === secondLocale.value && firstPathname.value === secondPathname.value

          expect(first.value === second.value).toBe(sameTuple)
        },
      ),
      { numRuns: 200 },
    )
  })

  it.each([
    { code: "URL_PATH_QUERY_OR_FRAGMENT", input: "/guide?draft=1" },
    { code: "URL_PATH_QUERY_OR_FRAGMENT", input: "/guide#section" },
    { code: "URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS", input: "/guide%2Fhidden" },
  ])("rejects ambiguous pathname $input with $code", ({ code, input }) => {
    // Given / When
    const result = normalizePathname(input)

    // Then
    expect(result).toMatchObject({ error: { code }, ok: false })
  })
})

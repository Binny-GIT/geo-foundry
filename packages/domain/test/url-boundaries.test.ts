import { afterEach, describe, expect, it, vi } from "vitest"
import {
  constructCanonicalUrl,
  normalizeHostname,
  normalizeLocale,
  normalizePathname,
} from "../src/index.js"
import { unwrapUrlResult } from "./url-fixtures.js"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("url boundary parsing", () => {
  it.each([null, "", " site-a.test", "site-a.test "])(
    "rejects malformed hostname boundary %j",
    (input) => {
      // Given / When
      const result = normalizeHostname(input)

      // Then
      expect(result).toMatchObject({ error: { code: "URL_INVALID_HOSTNAME" }, ok: false })
    },
  )

  it.each(["https://site-a.test", "site-a.test/path", "user@site-a.test", "site-a.test:443"])(
    "rejects hostname URL component %s",
    (input) => {
      // Given / When
      const result = normalizeHostname(input)

      // Then
      expect(result).toMatchObject({ error: { code: "URL_INVALID_HOSTNAME" }, ok: false })
    },
  )

  it("rejects a hostname that the URL standard cannot parse", () => {
    // Given / When
    const result = normalizeHostname("bad host.test")

    // Then
    expect(result).toMatchObject({ error: { code: "URL_INVALID_HOSTNAME" }, ok: false })
  })

  it("removes a DNS root dot", () => {
    // Given / When
    const result = unwrapUrlResult(normalizeHostname("SITE-A.TEST."))

    // Then
    expect(result.value).toBe("site-a.test")
  })

  it.each([null, "", " en-US", "en_US", "en--US"])(
    "rejects malformed locale boundary %j",
    (input) => {
      // Given / When
      const result = normalizeLocale(input)

      // Then
      expect(result).toMatchObject({ error: { code: "URL_INVALID_LOCALE" }, ok: false })
    },
  )

  it("rejects an empty canonical locale result", () => {
    // Given
    vi.spyOn(Intl, "getCanonicalLocales").mockReturnValue([])

    // When
    const result = normalizeLocale("en-US")

    // Then
    expect(result).toMatchObject({ error: { code: "URL_INVALID_LOCALE" }, ok: false })
  })

  it("rethrows an unexpected locale runtime error", () => {
    // Given
    vi.spyOn(Intl, "getCanonicalLocales").mockImplementation(() => {
      throw new TypeError("unexpected locale runtime failure")
    })

    // When / Then
    expect(() => normalizeLocale("en-US")).toThrow(TypeError)
  })

  it.each([null, "relative", "/guide\\hidden", "/./guide", "/guide/..", "/%ZZ", "/%C0"])(
    "rejects malformed pathname boundary %j",
    (input) => {
      // Given / When
      const result = normalizePathname(input)

      // Then
      expect(result).toMatchObject({ error: { code: "URL_INVALID_PATHNAME" }, ok: false })
    },
  )

  it.each(["/%2f", "/%5C", "/%252F", "/%2525255c"])(
    "rejects encoded separator ambiguity %s",
    (input) => {
      // Given / When
      const result = normalizePathname(input)

      // Then
      expect(result).toMatchObject({
        error: { code: "URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS" },
        ok: false,
      })
    },
  )

  it("rethrows an unexpected pathname decoder error", () => {
    // Given
    vi.stubGlobal("decodeURIComponent", () => {
      throw new TypeError("unexpected decoder failure")
    })

    // When / Then
    expect(() => normalizePathname("/guide")).toThrow(TypeError)
  })

  it("normalizes root and RFC 3986 special characters", () => {
    // Given
    const hostname = unwrapUrlResult(normalizeHostname("site-a.test"))
    const locale = unwrapUrlResult(normalizeLocale("en-us"))
    const root = unwrapUrlResult(normalizePathname("///"))

    // When
    const special = unwrapUrlResult(normalizePathname("/!guide'(draft)*"))
    const canonical = constructCanonicalUrl({ hostname, locale, pathname: root })

    // Then
    expect(root.value).toBe("/")
    expect(special.value).toBe("/%21guide%27%28draft%29%2A")
    expect(canonical.value).toBe("https://site-a.test/en-US/")
  })
})

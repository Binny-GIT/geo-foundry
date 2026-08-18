import { DOMAIN_ERROR_CODE } from "../errors.js"
import type { SiteId } from "../ids.js"
import { err, ok, type DomainResult } from "../result.js"
import { UrlBoundaryError } from "./errors.js"

type StandardUrl = Readonly<{
  readonly href: string
  readonly hostname: string
  readonly pathname: string
  readonly port: string
}>

declare const URL: {
  new (input: string, base?: string): StandardUrl
  canParse(input: string, base?: string): boolean
}

const hostnameBrand: unique symbol = Symbol("geo.url.hostname")
const localeBrand: unique symbol = Symbol("geo.url.locale")
const pathnameBrand: unique symbol = Symbol("geo.url.pathname")
const canonicalUrlBrand: unique symbol = Symbol("geo.url.canonical")
const uniqueKeyBrand: unique symbol = Symbol("geo.url.unique-key")

export type NormalizedHostname = Readonly<{
  readonly value: string
  readonly [hostnameBrand]: "NormalizedHostname"
}>

export type NormalizedLocale = Readonly<{
  readonly value: string
  readonly [localeBrand]: "NormalizedLocale"
}>

export type NormalizedPathname = Readonly<{
  readonly value: string
  readonly [pathnameBrand]: "NormalizedPathname"
}>

export type CanonicalUrl = Readonly<{
  readonly value: string
  readonly [canonicalUrlBrand]: "CanonicalUrl"
}>

export type UrlUniqueKey = Readonly<{
  readonly value: string
  readonly [uniqueKeyBrand]: "UrlUniqueKey"
}>

export type UrlAddress = Readonly<{
  readonly locale: NormalizedLocale
  readonly pathname: NormalizedPathname
  readonly siteId: SiteId
}>

function boundaryValue(received: unknown): string {
  return typeof received === "string" ? received : typeof received
}

export function normalizeHostname(received: unknown): DomainResult<NormalizedHostname> {
  if (typeof received !== "string" || received.length === 0 || received.trim() !== received) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_INVALID_HOSTNAME,
        "Hostname must be a non-empty unpadded string",
        boundaryValue(received),
      ),
    )
  }
  const normalizedInput = received.normalize("NFC")
  if (/[/:@?#\\]/u.test(normalizedInput)) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_INVALID_HOSTNAME,
        "Hostname must not contain URL components",
        received,
      ),
    )
  }
  const urlInput = `https://${normalizedInput}/`
  if (!URL.canParse(urlInput)) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_INVALID_HOSTNAME,
        "Hostname is not valid",
        received,
      ),
    )
  }
  const parsed = new URL(urlInput)
  const value = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname
  return ok(Object.freeze({ [hostnameBrand]: "NormalizedHostname" as const, value }))
}

export function normalizeLocale(received: unknown): DomainResult<NormalizedLocale> {
  if (typeof received !== "string" || received.length === 0 || received.trim() !== received) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_INVALID_LOCALE,
        "Locale must be a non-empty unpadded string",
        boundaryValue(received),
      ),
    )
  }
  try {
    const values = Intl.getCanonicalLocales(received.normalize("NFC"))
    const value = values[0]
    if (values.length !== 1 || value === undefined) {
      return err(
        new UrlBoundaryError(DOMAIN_ERROR_CODE.URL_INVALID_LOCALE, "Locale is not valid", received),
      )
    }
    return ok(Object.freeze({ [localeBrand]: "NormalizedLocale" as const, value }))
  } catch (error) {
    if (error instanceof RangeError) {
      return err(
        new UrlBoundaryError(DOMAIN_ERROR_CODE.URL_INVALID_LOCALE, "Locale is not valid", received),
      )
    }
    throw error
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function normalizePathname(received: unknown): DomainResult<NormalizedPathname> {
  if (typeof received !== "string" || !received.startsWith("/") || received.includes("\\")) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_INVALID_PATHNAME,
        "Pathname must be an absolute slash-delimited path",
        boundaryValue(received),
      ),
    )
  }
  if (received.includes("?") || received.includes("#")) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_PATH_QUERY_OR_FRAGMENT,
        "Pathname must not contain a query or fragment",
        received,
      ),
    )
  }
  if (/%(?:25)*(?:2f|5c)/iu.test(received)) {
    return err(
      new UrlBoundaryError(
        DOMAIN_ERROR_CODE.URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS,
        "Pathname must not contain an encoded separator",
        received,
      ),
    )
  }

  const normalizedSegments: string[] = []
  for (const segment of received.normalize("NFC").split("/")) {
    if (segment.length === 0) {
      continue
    }
    try {
      const decoded = decodeURIComponent(segment).normalize("NFC")
      if (decoded === "." || decoded === "..") {
        return err(
          new UrlBoundaryError(
            DOMAIN_ERROR_CODE.URL_INVALID_PATHNAME,
            "Pathname must not contain dot segments",
            received,
          ),
        )
      }
      normalizedSegments.push(encodeSegment(decoded))
    } catch (error) {
      if (error instanceof URIError) {
        return err(
          new UrlBoundaryError(
            DOMAIN_ERROR_CODE.URL_INVALID_PATHNAME,
            "Pathname contains malformed percent encoding",
            received,
          ),
        )
      }
      throw error
    }
  }
  const value = normalizedSegments.length === 0 ? "/" : `/${normalizedSegments.join("/")}`
  return ok(Object.freeze({ [pathnameBrand]: "NormalizedPathname" as const, value }))
}

export function urlUniqueKey(address: UrlAddress): UrlUniqueKey {
  return Object.freeze({
    [uniqueKeyBrand]: "UrlUniqueKey" as const,
    value: JSON.stringify([address.siteId.value, address.locale.value, address.pathname.value]),
  })
}

export function constructCanonicalUrl(
  input: Readonly<{
    readonly hostname: NormalizedHostname
    readonly locale: NormalizedLocale
    readonly pathname: NormalizedPathname
  }>,
): CanonicalUrl {
  const localizedPath =
    input.pathname.value === "/"
      ? `/${input.locale.value}/`
      : `/${input.locale.value}${input.pathname.value}`
  return Object.freeze({
    [canonicalUrlBrand]: "CanonicalUrl" as const,
    value: new URL(localizedPath, `https://${input.hostname.value}`).href,
  })
}

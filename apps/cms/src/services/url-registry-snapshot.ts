import {
  constructCanonicalUrl,
  createUrlRegistry,
  normalizeHostname,
  normalizeLocale,
  normalizePathname,
  parseContentId,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  type UrlRegistry,
  type UrlRoute,
  urlUniqueKey,
} from "@geo/domain"

import { UrlRegistryError } from "./url-registry-errors"

export const RESERVED_PATHNAMES: readonly string[] = [
  "/admin",
  "/api",
  "/api/graphql",
  "/media",
  "/robots.txt",
  "/sitemap.xml",
]

export type UrlRecordState = "reserved" | "active" | "redirected" | "gone"

export type UrlRecordRow = {
  readonly id: number
  readonly site: number
  readonly tenant: number
  readonly content: number
  readonly locale: string
  readonly pathname: string
  readonly state: UrlRecordState
  readonly canonicalUrl: string | null
  readonly statusCode: number | null
  readonly targetUrl: number | null
  readonly revision: number
}

export type UrlRecordDoc = {
  readonly id: number
  readonly site: unknown
  readonly tenant: unknown
  readonly content: unknown
  readonly locale: unknown
  readonly pathname: unknown
  readonly state: unknown
  readonly canonicalUrl: unknown
  readonly statusCode: unknown
  readonly targetUrl: unknown
  readonly revision: unknown
}

const fail = (code: string, detail: string): UrlRegistryError => new UrlRegistryError(code, detail)

const numberField = (value: unknown): number | null => (typeof value === "number" ? value : null)

const stringField = (value: unknown): string | null => (typeof value === "string" ? value : null)

const parseState = (value: unknown): UrlRecordState => {
  switch (value) {
    case "active":
    case "gone":
    case "redirected":
    case "reserved":
      return value
    default:
      throw fail("URL_RECORD_ROW_INVALID", `record state ${String(value)}`)
  }
}

export function toUrlRecordRow(doc: UrlRecordDoc): UrlRecordRow {
  const site = numberField(doc.site)
  const tenant = numberField(doc.tenant)
  const content = numberField(doc.content)
  if (site === null || tenant === null || content === null) {
    throw fail("URL_RECORD_ROW_INVALID", `record ${doc.id} ownership`)
  }
  return {
    id: doc.id,
    site,
    tenant,
    content,
    locale: stringField(doc.locale) ?? "",
    pathname: stringField(doc.pathname) ?? "",
    state: parseState(doc.state),
    canonicalUrl: stringField(doc.canonicalUrl),
    statusCode: numberField(doc.statusCode),
    targetUrl: numberField(doc.targetUrl),
    revision: numberField(doc.revision) ?? 0,
  }
}

function rowToRoute(row: UrlRecordRow): UrlRoute {
  const siteId = parseSiteId(String(row.site))
  const tenantId = parseTenantId(String(row.tenant))
  const contentId = parseContentId(String(row.content))
  const urlId = parseUrlId(String(row.id))
  const locale = normalizeLocale(row.locale)
  const pathname = normalizePathname(row.pathname)
  if (!siteId.ok || !tenantId.ok || !contentId.ok || !urlId.ok || !locale.ok || !pathname.ok) {
    throw fail("URL_RECORD_ROW_INVALID", `row ${row.id}`)
  }
  const ownership = Object.freeze({
    scope: "site" as const,
    siteId: siteId.value,
    tenantId: tenantId.value,
  })
  const base = {
    contentId: contentId.value,
    id: urlId.value,
    key: urlUniqueKey({
      locale: locale.value,
      pathname: pathname.value,
      siteId: siteId.value,
    }),
    locale: locale.value,
    ownership,
    pathname: pathname.value,
  }
  switch (row.state) {
    case "reserved":
      return Object.freeze({ ...base, state: "reserved" as const })
    case "gone":
      return Object.freeze({ ...base, state: "gone" as const })
    case "active": {
      const hostname = normalizeHostname(
        row.canonicalUrl === null || !URL.canParse(row.canonicalUrl)
          ? ""
          : new URL(row.canonicalUrl).hostname,
      )
      if (!hostname.ok) {
        throw fail("URL_RECORD_ROW_INVALID", `active row ${row.id} lacks canonical url`)
      }
      return Object.freeze({
        ...base,
        canonicalUrl: constructCanonicalUrl({
          hostname: hostname.value,
          locale: locale.value,
          pathname: pathname.value,
        }),
        state: "active" as const,
      })
    }
    case "redirected": {
      const targetUrlId = parseUrlId(String(row.targetUrl))
      if (!targetUrlId.ok) {
        throw fail("URL_RECORD_ROW_INVALID", `redirect row ${row.id} target id`)
      }
      return Object.freeze({
        ...base,
        state: "redirected" as const,
        statusCode: 301 as const,
        targetUrlId: targetUrlId.value,
      })
    }
    default:
      throw fail("URL_RECORD_ROW_INVALID", `row ${row.id} state`)
  }
}

/**
 * Deterministic UrlRegistry snapshot rebuilt from persisted rows inside the
 * caller's transaction, so domain validation always sees committed state.
 */
export function buildSiteRegistry(rows: readonly UrlRecordRow[]): UrlRegistry {
  const base = createUrlRegistry({ reservedPathnames: RESERVED_PATHNAMES })
  if (!base.ok) {
    throw fail("URL_REGISTRY_RESERVED_INVALID", "reserved pathname constants")
  }
  return Object.freeze({
    reservedPathnames: base.value.reservedPathnames,
    revision: rows.length,
    routes: Object.freeze(rows.map(rowToRoute)),
  })
}

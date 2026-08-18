import {
  createUrlRegistry,
  parseContentId,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  type DomainResult,
  type SiteOwnership,
  type UrlRegistry,
} from "../src/index.js"
import { unwrapResult } from "./fixtures.js"

export const urlTenantId = unwrapResult(parseTenantId("tenant-url"))
export const urlSiteId = unwrapResult(parseSiteId("site-url"))
export const urlOtherSiteId = unwrapResult(parseSiteId("site-url-other"))
export const urlOtherTenantId = unwrapResult(parseTenantId("tenant-url-other"))
export const urlContentId = unwrapResult(parseContentId("content-url"))
export const firstUrlId = unwrapResult(parseUrlId("url-first"))
export const secondUrlId = unwrapResult(parseUrlId("url-second"))
export const thirdUrlId = unwrapResult(parseUrlId("url-third"))

export const urlOwnership: SiteOwnership = Object.freeze({
  scope: "site",
  siteId: urlSiteId,
  tenantId: urlTenantId,
})

export const otherSiteOwnership: SiteOwnership = Object.freeze({
  scope: "site",
  siteId: urlOtherSiteId,
  tenantId: urlTenantId,
})

export const otherTenantOwnership: SiteOwnership = Object.freeze({
  scope: "site",
  siteId: urlSiteId,
  tenantId: urlOtherTenantId,
})

export function unwrapUrlResult<T>(result: DomainResult<T>): T {
  return unwrapResult(result)
}

export function emptyUrlRegistry(): UrlRegistry {
  return unwrapUrlResult(createUrlRegistry({ reservedPathnames: ["/admin", "/api"] }))
}

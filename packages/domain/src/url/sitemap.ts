import { DOMAIN_ERROR_CODE } from "../errors.js"
import { assertNever } from "../exhaustive.js"
import { err, ok, type DomainResult } from "../result.js"
import { UrlInvariantError } from "./errors.js"
import type { ActiveUrlRoute, UrlRoute } from "./types.js"

export function requireSitemapEligible(route: UrlRoute): DomainResult<ActiveUrlRoute> {
  switch (route.state) {
    case "active":
      return ok(route)
    case "reserved":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_SITEMAP_DRAFT_INELIGIBLE,
          "Reserved URLs are not eligible for sitemap inclusion",
          route.id.value,
        ),
      )
    case "redirected":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_SITEMAP_REDIRECT_INELIGIBLE,
          "Redirected URLs are not eligible for sitemap inclusion",
          route.id.value,
        ),
      )
    case "gone":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_SITEMAP_GONE_INELIGIBLE,
          "Gone URLs are not eligible for sitemap inclusion",
          route.id.value,
        ),
      )
    default:
      return assertNever(route)
  }
}

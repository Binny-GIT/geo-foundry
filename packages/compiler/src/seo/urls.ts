import { COMPILER_ERROR, CompilerError } from "../compile/errors.js"

export type CanonicalDomainSite = { readonly canonicalDomain: string }

/**
 * Lowercase DNS hostname: labels of [a-z0-9-] (no leading/trailing dash),
 * at least two labels, no scheme, port, path, or userinfo. Canonical URLs
 * are always derived, never trusted from inputs, so the domain itself is
 * the only thing that can smuggle in a wrong origin.
 */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

export const canonicalDomainOf = (site: CanonicalDomainSite): string => {
  const domain = site.canonicalDomain.trim().toLowerCase()
  if (!HOSTNAME.test(domain)) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
      `canonical domain "${site.canonicalDomain}" is not a bare lowercase-able hostname`,
    )
  }
  return domain
}

/** Absolute canonical URL: https + canonical domain + in-site pathname. */
export const canonicalUrlOf = (site: CanonicalDomainSite, pathname: string): string => {
  const domain = canonicalDomainOf(site)
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
      `pathname "${pathname}" must be site-absolute (start with /) for https://${domain}`,
    )
  }
  return `https://${domain}${pathname}`
}

/**
 * Accepts a full https URL only when its host is exactly the site's
 * canonical domain; anything else (other host, scheme, port) is a
 * wrong-domain canonical and fails typed.
 */
export const assertUrlOnCanonicalDomain = (
  site: CanonicalDomainSite,
  url: string,
  field: string,
): string => {
  const domain = canonicalDomainOf(site)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new CompilerError(
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
      `${field} "${url}" is not an absolute URL for https://${domain}`,
    )
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== domain) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_CANONICAL_WRONG_DOMAIN,
      `${field} "${url}" is not on canonical domain ${domain}`,
    )
  }
  return `https://${domain}${parsed.pathname}${parsed.search}`
}

/** Site-relative asset paths become canonical-domain URLs; full URLs must match. */
export const assetUrlOf = (site: CanonicalDomainSite, path: string, field: string): string => {
  if (typeof path === "string" && path.startsWith("/")) {
    return canonicalUrlOf(site, path)
  }
  return assertUrlOnCanonicalDomain(site, path, field)
}

const parseRedirectTarget = (site: CanonicalDomainSite, targetUrl: string): string => {
  if (typeof targetUrl !== "string" || targetUrl.length === 0) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
      `redirect target "${String(targetUrl)}" is empty`,
    )
  }
  if (targetUrl.startsWith("/")) {
    return canonicalUrlOf(site, targetUrl)
  }
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    throw new CompilerError(
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
      `redirect target "${targetUrl}" is neither site-relative nor an absolute URL`,
    )
  }
  if (parsed.protocol !== "https:") {
    throw new CompilerError(
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
      `redirect target "${targetUrl}" must use https`,
    )
  }
  return targetUrl
}

/**
 * Redirect semantics: the target may live anywhere (cross-domain moves are
 * legitimate) but must never resolve back to the redirect's own canonical
 * URL - that would make the page its own canonical, which is the mismatch
 * crawlers punish. The redirect document keeps its source canonical URL.
 */
export const assertRedirectTarget = (
  site: CanonicalDomainSite,
  fromPathname: string,
  targetUrl: string,
): string => {
  const resolved = parseRedirectTarget(site, targetUrl)
  const canonical = canonicalUrlOf(site, fromPathname)
  if (resolved === canonical) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_REDIRECT_CANONICAL_MISMATCH,
      `redirect ${fromPathname} targets its own canonical URL ${canonical}`,
    )
  }
  return resolved
}

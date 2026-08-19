import type { PageDocument } from "@geo/schema"

import { CompilerError, COMPILER_ERROR } from "../compile/errors.js"
import { canonicalDomainOf } from "../seo/urls.js"

export type RouteStatus = "active" | "redirect" | "not-found"

export type RouteIndexEntry = {
  readonly objectKey: string
  readonly pageType: PageDocument["pageType"]
  readonly pathname: string
  readonly status: RouteStatus
}

export type RouteIndex = {
  readonly canonicalDomain: string
  readonly routes: readonly RouteIndexEntry[]
  readonly schemaVersion: 1
  readonly siteId: string
}

const ACTIVE_TYPES: readonly PageDocument["pageType"][] = [
  "article",
  "article-list",
  "category",
  "tag",
]

/** Release object key of a page document: pages/<pathname>.json. */
export const objectKeyOf = (pathname: string): string =>
  pathname === "/" ? "pages/index.json" : `pages${pathname}.json`

const pathnameOfTarget = (
  canonicalDomain: string,
  targetUrl: string,
): { readonly external: boolean; readonly pathname: string | null } => {
  if (targetUrl.startsWith("/")) {
    return { external: false, pathname: targetUrl }
  }
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== "https:") {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
        `redirect target ${targetUrl} is not https and not site-relative`,
      )
    }
    if (parsed.hostname.toLowerCase() !== canonicalDomain) {
      return { external: true, pathname: null }
    }
    return { external: false, pathname: parsed.pathname }
  } catch (error) {
    if (error instanceof CompilerError) {
      throw error
    }
    throw new CompilerError(
      COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
      `redirect target ${targetUrl} is neither site-relative nor an absolute URL`,
    )
  }
}

export type RouteIndexInput = {
  readonly canonicalDomain: string
  readonly documents: readonly {
    readonly pageType: PageDocument["pageType"]
    readonly pathname: string
  }[]
  /** Other sites' canonical domains, to catch cross-site references. */
  readonly knownDomains?: readonly string[]
  readonly redirects: readonly { readonly fromPathname: string; readonly targetUrl: string }[]
  readonly siteId: string
}

/**
 * Per-site route index: every emitted document keyed by normalized pathname,
 * with single-hop redirects validated against the active routes of the same
 * site. Drafts and gone URLs never appear because only compiled documents
 * reach this builder; redirect targets are never duplicated as active
 * entries - the target keeps its own single route.
 */
export const buildRouteIndex = (input: RouteIndexInput): RouteIndex => {
  const canonicalDomain = canonicalDomainOf({ canonicalDomain: input.canonicalDomain })
  for (const foreign of input.knownDomains ?? []) {
    if (foreign.toLowerCase() === canonicalDomain) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_CROSS_SITE_REFERENCE,
        `knownDomains lists this site's own domain ${canonicalDomain}`,
      )
    }
  }

  const routes = new Map<string, RouteIndexEntry>()
  const claim = (pathname: string, entry: RouteIndexEntry): void => {
    const existing = routes.get(pathname)
    if (existing !== undefined) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_PATH_COLLISION,
        `pathname ${pathname} claimed by ${existing.pageType}/${existing.status} and ${entry.pageType}/${entry.status}`,
      )
    }
    routes.set(pathname, entry)
  }

  const activePathnames = new Set<string>()
  for (const document of input.documents) {
    const status: RouteStatus =
      document.pageType === "not-found"
        ? "not-found"
        : ACTIVE_TYPES.includes(document.pageType)
          ? "active"
          : "redirect"
    if (status === "active") {
      activePathnames.add(document.pathname)
    }
    claim(document.pathname, {
      objectKey: objectKeyOf(document.pathname),
      pageType: document.pageType,
      pathname: document.pathname,
      status,
    })
  }

  const redirectTargets = new Map<string, string>()
  for (const redirect of input.redirects) {
    // The pipeline already emits redirect documents; re-registering the same
    // from-pathname is idempotent, anything else claiming it is a collision.
    const existing = routes.get(redirect.fromPathname)
    if (existing === undefined) {
      routes.set(redirect.fromPathname, {
        objectKey: objectKeyOf(redirect.fromPathname),
        pageType: "redirect",
        pathname: redirect.fromPathname,
        status: "redirect",
      })
    } else if (existing.pageType !== "redirect") {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_PATH_COLLISION,
        `pathname ${redirect.fromPathname} claimed by ${existing.pageType}/${existing.status} and redirect/redirect`,
      )
    }
    redirectTargets.set(redirect.fromPathname, redirect.targetUrl)
  }

  for (const [fromPathname, targetUrl] of redirectTargets) {
    const target = pathnameOfTarget(canonicalDomain, targetUrl)
    if (target.external) {
      const host = new URL(targetUrl).hostname.toLowerCase()
      if ((input.knownDomains ?? []).some((domain) => domain.toLowerCase() === host)) {
        throw new CompilerError(
          COMPILER_ERROR.ROUTE_CROSS_SITE_REFERENCE,
          `redirect ${fromPathname} targets sibling site domain ${host}; use its public URL contract instead`,
        )
      }
      continue
    }
    const targetPathname = target.pathname
    if (targetPathname === null) {
      continue
    }
    if (redirectTargets.has(targetPathname)) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_REDIRECT_LOOP,
        `redirect ${fromPathname} targets ${targetPathname}, which is itself a redirect (single hop only)`,
      )
    }
    if (!activePathnames.has(targetPathname)) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
        `redirect ${fromPathname} targets ${targetPathname}, which has no active route on ${canonicalDomain}`,
      )
    }
  }

  return {
    canonicalDomain,
    routes: [...routes.values()].sort((left, right) => left.pathname.localeCompare(right.pathname)),
    schemaVersion: 1,
    siteId: input.siteId,
  }
}

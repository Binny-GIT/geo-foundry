import type { PageDocument } from "@geo/schema"
import {
  routeIndexOf,
  type RouteIndex,
  type RouteIndexEntry,
  type RouteStatus,
} from "@geo/schema/release/v1"

import { CompilerError, COMPILER_ERROR } from "../compile/errors.js"
import { canonicalDomainOf } from "../seo/urls.js"

export type { RouteIndex, RouteIndexEntry, RouteStatus }

type RawRouteIndexEntry =
  | {
      readonly objectKey: string
      readonly pageType: "article" | "article-list" | "category" | "tag"
      readonly pathname: string
      readonly status: "active"
    }
  | {
      readonly objectKey: string
      readonly pageType: "redirect"
      readonly pathname: string
      readonly status: "redirect"
    }
  | { readonly pathname: string; readonly status: "gone" }
  | {
      readonly objectKey: string
      readonly pageType: "not-found"
      readonly pathname: string
      readonly status: "not-found"
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
  readonly gonePathnames?: readonly string[]
  /** Other sites' canonical domains, to catch cross-site references. */
  readonly knownDomains?: readonly string[]
  readonly redirects: readonly { readonly fromPathname: string; readonly targetUrl: string }[]
  readonly siteId: string
}

/**
 * Per-site route index: emitted documents plus deterministic terminal 410
 * entries for gone URLs. The gone entries intentionally carry no object key:
 * Runtime returns 410 without reading a PageDocument.
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

  const routes = new Map<string, RawRouteIndexEntry>()
  const claim = (pathname: string, entry: RawRouteIndexEntry): void => {
    const existing = routes.get(pathname)
    if (existing !== undefined) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_PATH_COLLISION,
        `pathname ${pathname} claimed by ${existing.status} and ${entry.status}`,
      )
    }
    routes.set(pathname, entry)
  }

  const activePathnames = new Set<string>()
  for (const document of input.documents) {
    const status =
      document.pageType === "not-found"
        ? "not-found"
        : ACTIVE_TYPES.includes(document.pageType)
          ? "active"
          : "redirect"
    if (status === "active") {
      const pageType = document.pageType
      if (
        pageType !== "article" &&
        pageType !== "article-list" &&
        pageType !== "category" &&
        pageType !== "tag"
      ) {
        throw new CompilerError(
          COMPILER_ERROR.ROUTE_PATH_COLLISION,
          `page type ${pageType} cannot produce an active route`,
        )
      }
      activePathnames.add(document.pathname)
      claim(document.pathname, {
        objectKey: objectKeyOf(document.pathname),
        pageType,
        pathname: document.pathname,
        status,
      })
      continue
    }
    if (status === "not-found") {
      claim(document.pathname, {
        objectKey: objectKeyOf(document.pathname),
        pageType: "not-found",
        pathname: document.pathname,
        status,
      })
      continue
    }
    claim(document.pathname, {
      objectKey: objectKeyOf(document.pathname),
      pageType: "redirect",
      pathname: document.pathname,
      status,
    })
  }

  for (const pathname of [...(input.gonePathnames ?? [])].sort()) {
    claim(pathname, { pathname, status: "gone" })
  }

  const redirectTargets = new Map<string, string>()
  for (const redirect of input.redirects) {
    const existing = routes.get(redirect.fromPathname)
    if (existing === undefined) {
      routes.set(redirect.fromPathname, {
        objectKey: objectKeyOf(redirect.fromPathname),
        pageType: "redirect",
        pathname: redirect.fromPathname,
        status: "redirect",
      })
    } else if (existing.status !== "redirect") {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_PATH_COLLISION,
        `pathname ${redirect.fromPathname} claimed by ${existing.status} and redirect`,
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
    if (target.pathname === null) {
      continue
    }
    if (redirectTargets.has(target.pathname)) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_REDIRECT_LOOP,
        `redirect ${fromPathname} targets ${target.pathname}, which is itself a redirect (single hop only)`,
      )
    }
    if (!activePathnames.has(target.pathname)) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
        `redirect ${fromPathname} targets ${target.pathname}, which has no active route on ${canonicalDomain}`,
      )
    }
  }

  return routeIndexOf({
    canonicalDomain,
    routes: [...routes.values()],
    schemaVersion: 1,
    siteId: input.siteId,
  })
}

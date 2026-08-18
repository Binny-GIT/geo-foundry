import { DOMAIN_ERROR_CODE } from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { UrlId } from "../ids.js"
import { freezeOwnership, type SiteOwnership } from "../ownership.js"
import { err, ok, type DomainResult } from "../result.js"
import type {
  PublishUrlInput,
  PublishedUrlChange,
  ReserveUrlInput,
  ReservedUrlChange,
  RetainActiveUrlInput,
} from "./contracts.js"
import { UrlInvariantError } from "./errors.js"
import {
  constructCanonicalUrl,
  normalizeHostname,
  normalizeLocale,
  normalizePathname,
  type NormalizedLocale,
  type NormalizedPathname,
  urlUniqueKey,
} from "./normalization.js"
import type { ActiveUrlRoute, UrlRegistry, UrlRoute } from "./types.js"

function freezeRegistry(input: UrlRegistry): UrlRegistry {
  return Object.freeze({
    reservedPathnames: Object.freeze([...input.reservedPathnames]),
    revision: input.revision,
    routes: Object.freeze([...input.routes]),
  })
}

function findRoute(registry: UrlRegistry, urlId: UrlId): UrlRoute | null {
  return registry.routes.find((route) => route.id.value === urlId.value) ?? null
}

function revisionError(registry: UrlRegistry, expectedRevision: number): DomainResult<null> {
  return registry.revision === expectedRevision
    ? ok(null)
    : err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_REGISTRY_REVISION_CONFLICT,
          "URL registry revision is stale",
          `${expectedRevision}:${registry.revision}`,
        ),
      )
}

function parseAddress(
  input: Readonly<{
    readonly locale: unknown
    readonly ownership: SiteOwnership
    readonly pathname: unknown
  }>,
): DomainResult<Readonly<{ locale: NormalizedLocale; pathname: NormalizedPathname }>> {
  const locale = normalizeLocale(input.locale)
  if (!locale.ok) {
    return locale
  }
  const pathname = normalizePathname(input.pathname)
  if (!pathname.ok) {
    return pathname
  }
  return ok(Object.freeze({ locale: locale.value, pathname: pathname.value }))
}

function replaceRoute(registry: UrlRegistry, route: UrlRoute): UrlRegistry {
  return freezeRegistry({
    ...registry,
    revision: registry.revision + 1,
    routes: registry.routes.map((candidate) =>
      candidate.id.value === route.id.value ? route : candidate,
    ),
  })
}

export function createUrlRegistry(
  input: Readonly<{
    readonly reservedPathnames: readonly unknown[]
  }>,
): DomainResult<UrlRegistry> {
  const reservedPathnames: NormalizedPathname[] = []
  for (const value of input.reservedPathnames) {
    const pathname = normalizePathname(value)
    if (!pathname.ok) {
      return pathname
    }
    if (!reservedPathnames.some((candidate) => candidate.value === pathname.value.value)) {
      reservedPathnames.push(pathname.value)
    }
  }
  reservedPathnames.sort((left, right) => left.value.localeCompare(right.value))
  return ok(freezeRegistry({ reservedPathnames, revision: 0, routes: [] }))
}

export function reserveUrl(
  registry: UrlRegistry,
  input: ReserveUrlInput,
): DomainResult<ReservedUrlChange> {
  const revision = revisionError(registry, input.expectedRevision)
  if (!revision.ok) {
    return revision
  }
  const address = parseAddress(input)
  if (!address.ok) {
    return address
  }
  if (registry.reservedPathnames.some((value) => value.value === address.value.pathname.value)) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_RESERVED_ROUTE_COLLISION,
        "Pathname collides with a reserved route",
        address.value.pathname.value,
      ),
    )
  }
  if (findRoute(registry, input.urlId) !== null) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_ID_COLLISION,
        "URL identifier already exists",
        input.urlId.value,
      ),
    )
  }
  const ownership = freezeOwnership(input.ownership)
  const key = urlUniqueKey({
    locale: address.value.locale,
    pathname: address.value.pathname,
    siteId: ownership.siteId,
  })
  if (registry.routes.some((route) => route.key.value === key.value)) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_UNIQUE_KEY_COLLISION,
        "Normalized URL key already exists",
        key.value,
      ),
    )
  }
  const reserved = Object.freeze({
    contentId: input.contentId,
    id: input.urlId,
    key,
    locale: address.value.locale,
    ownership,
    pathname: address.value.pathname,
    state: "reserved" as const,
  })
  const nextRegistry = freezeRegistry({
    ...registry,
    revision: registry.revision + 1,
    routes: [...registry.routes, reserved],
  })
  return ok(Object.freeze({ registry: nextRegistry, reserved }))
}

export function publishUrl(
  registry: UrlRegistry,
  input: PublishUrlInput,
): DomainResult<PublishedUrlChange> {
  const revision = revisionError(registry, input.expectedRevision)
  if (!revision.ok) {
    return revision
  }
  const route = findRoute(registry, input.urlId)
  if (route === null) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_RECORD_NOT_FOUND,
        "URL record was not found",
        input.urlId.value,
      ),
    )
  }
  switch (route.state) {
    case "reserved":
      break
    case "active":
    case "gone":
    case "redirected":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_RECORD_NOT_RESERVED,
          "Only a reserved URL can be published",
          route.id.value,
        ),
      )
    default:
      return assertNever(route)
  }
  const hostname = normalizeHostname(input.hostname)
  if (!hostname.ok) {
    return hostname
  }
  const active = Object.freeze({
    ...route,
    canonicalUrl: constructCanonicalUrl({
      hostname: hostname.value,
      locale: route.locale,
      pathname: route.pathname,
    }),
    state: "active" as const,
  })
  return ok(Object.freeze({ active, registry: replaceRoute(registry, active) }))
}

export function retainActiveUrlForContentUpdate(
  registry: UrlRegistry,
  input: RetainActiveUrlInput,
): DomainResult<ActiveUrlRoute> {
  const route = findRoute(registry, input.urlId)
  if (route === null) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_RECORD_NOT_FOUND,
        "URL record was not found",
        input.urlId.value,
      ),
    )
  }
  switch (route.state) {
    case "active":
      return ok(route)
    case "gone":
    case "redirected":
    case "reserved":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_RECORD_NOT_ACTIVE,
          "Content updates require an active URL",
          route.id.value,
        ),
      )
    default:
      return assertNever(route)
  }
}

import { DOMAIN_ERROR_CODE } from "../errors.js"
import { assertNever } from "../exhaustive.js"
import { freezeOwnership } from "../ownership.js"
import { type DomainResult, err, ok } from "../result.js"
import type {
  GoneUrlChange,
  MarkUrlGoneInput,
  RenamedUrlChange,
  RenameUrlInput,
} from "./contracts.js"
import { UrlInvariantError } from "./errors.js"
import { validateRedirectGraph } from "./graph.js"
import {
  constructCanonicalUrl,
  normalizeHostname,
  normalizeLocale,
  normalizePathname,
  urlUniqueKey,
} from "./normalization.js"
import type {
  ActiveUrlRoute,
  GoneUrlRoute,
  RedirectedUrlRoute,
  UrlRegistry,
  UrlRoute,
} from "./types.js"

function findRoute(registry: UrlRegistry, id: string): UrlRoute | null {
  return registry.routes.find((route) => route.id.value === id) ?? null
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

function activeSource(registry: UrlRegistry, sourceId: string): DomainResult<ActiveUrlRoute> {
  const route = findRoute(registry, sourceId)
  if (route === null) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_RECORD_NOT_FOUND,
        "URL record was not found",
        sourceId,
      ),
    )
  }
  switch (route.state) {
    case "active":
      return ok(route)
    case "redirected":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_REDIRECT_CHAIN,
          "A redirected URL cannot be renamed again",
          sourceId,
        ),
      )
    case "gone":
    case "reserved":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_RECORD_NOT_ACTIVE,
          "URL record must be active",
          sourceId,
        ),
      )
    default:
      return assertNever(route)
  }
}

export function renameUrl(
  registry: UrlRegistry,
  input: RenameUrlInput,
): DomainResult<RenamedUrlChange> {
  const revision = revisionError(registry, input.expectedRevision)
  if (!revision.ok) {
    return revision
  }
  const source = activeSource(registry, input.sourceUrlId.value)
  if (!source.ok) {
    return source
  }
  if (source.value.ownership.tenantId.value !== input.targetOwnership.tenantId.value) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_REDIRECT_CROSS_TENANT,
        "Rename target must belong to the same tenant",
        source.value.id.value,
      ),
    )
  }
  if (source.value.ownership.siteId.value !== input.targetOwnership.siteId.value) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_REDIRECT_CROSS_SITE,
        "Rename target must belong to the same site",
        source.value.id.value,
      ),
    )
  }
  if (findRoute(registry, input.targetUrlId.value) !== null) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_ID_COLLISION,
        "Rename target identifier already exists",
        input.targetUrlId.value,
      ),
    )
  }
  const locale = normalizeLocale(input.locale)
  if (!locale.ok) {
    return locale
  }
  const pathname = normalizePathname(input.pathname)
  if (!pathname.ok) {
    return pathname
  }
  if (registry.reservedPathnames.some((value) => value.value === pathname.value.value)) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_RESERVED_ROUTE_COLLISION,
        "Rename target collides with a reserved route",
        pathname.value.value,
      ),
    )
  }
  const ownership = freezeOwnership(input.targetOwnership)
  const key = urlUniqueKey({
    locale: locale.value,
    pathname: pathname.value,
    siteId: ownership.siteId,
  })
  if (registry.routes.some((route) => route.key.value === key.value)) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_UNIQUE_KEY_COLLISION,
        "Rename target URL key already exists",
        key.value,
      ),
    )
  }
  const hostname = normalizeHostname(input.hostname)
  if (!hostname.ok) {
    return hostname
  }
  const active: ActiveUrlRoute = Object.freeze({
    canonicalUrl: constructCanonicalUrl({
      hostname: hostname.value,
      locale: locale.value,
      pathname: pathname.value,
    }),
    contentId: source.value.contentId,
    id: input.targetUrlId,
    key,
    locale: locale.value,
    ownership,
    pathname: pathname.value,
    state: "active",
  })
  const redirect: RedirectedUrlRoute = Object.freeze({
    contentId: source.value.contentId,
    id: source.value.id,
    key: source.value.key,
    locale: source.value.locale,
    ownership: source.value.ownership,
    pathname: source.value.pathname,
    state: "redirected",
    statusCode: 301,
    targetUrlId: active.id,
  })
  const nextRegistry: UrlRegistry = Object.freeze({
    reservedPathnames: Object.freeze([...registry.reservedPathnames]),
    revision: registry.revision + 1,
    routes: Object.freeze([
      ...registry.routes.map((route) => (route.id.value === redirect.id.value ? redirect : route)),
      active,
    ]),
  })
  const validatedRegistry = validateRedirectGraph(nextRegistry)
  if (!validatedRegistry.ok) {
    return validatedRegistry
  }
  return ok(Object.freeze({ active, redirect, registry: validatedRegistry.value }))
}

export function markUrlGone(
  registry: UrlRegistry,
  input: MarkUrlGoneInput,
): DomainResult<GoneUrlChange> {
  const revision = revisionError(registry, input.expectedRevision)
  if (!revision.ok) {
    return revision
  }
  const source = activeSource(registry, input.urlId.value)
  if (!source.ok) {
    return source
  }
  const gone: GoneUrlRoute = Object.freeze({
    contentId: source.value.contentId,
    id: source.value.id,
    key: source.value.key,
    locale: source.value.locale,
    ownership: source.value.ownership,
    pathname: source.value.pathname,
    state: "gone",
  })
  const nextRegistry: UrlRegistry = Object.freeze({
    reservedPathnames: Object.freeze([...registry.reservedPathnames]),
    revision: registry.revision + 1,
    routes: Object.freeze(
      registry.routes.map((route) => (route.id.value === gone.id.value ? gone : route)),
    ),
  })
  return ok(Object.freeze({ gone, registry: nextRegistry }))
}

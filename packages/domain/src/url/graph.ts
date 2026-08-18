import { DOMAIN_ERROR_CODE } from "../errors.js"
import { assertNever } from "../exhaustive.js"
import { err, ok, type DomainResult } from "../result.js"
import { UrlInvariantError } from "./errors.js"
import type { RedirectedUrlRoute, UrlRegistry, UrlRoute } from "./types.js"

function findRoute(registry: UrlRegistry, id: string): UrlRoute | null {
  return registry.routes.find((route) => route.id.value === id) ?? null
}

function validateOwnership(source: UrlRoute, target: UrlRoute): DomainResult<null> {
  if (source.ownership.tenantId.value !== target.ownership.tenantId.value) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_REDIRECT_CROSS_TENANT,
        "Redirect target must belong to the same tenant",
        source.id.value,
      ),
    )
  }
  if (source.ownership.siteId.value !== target.ownership.siteId.value) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_REDIRECT_CROSS_SITE,
        "Redirect target must belong to the same site",
        source.id.value,
      ),
    )
  }
  return ok(null)
}

function validateRedirect(registry: UrlRegistry, source: RedirectedUrlRoute): DomainResult<null> {
  const visited = new Set<string>([source.id.value])
  let current: UrlRoute = source
  let hops = 0

  while (current.state === "redirected") {
    if (visited.has(current.targetUrlId.value)) {
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_REDIRECT_LOOP,
          "Redirect graph must not contain a loop",
          source.id.value,
        ),
      )
    }
    visited.add(current.targetUrlId.value)
    const target = findRoute(registry, current.targetUrlId.value)
    if (target === null) {
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_REDIRECT_TARGET_NOT_ACTIVE,
          "Redirect target must exist and be active",
          source.id.value,
        ),
      )
    }
    const ownership = validateOwnership(current, target)
    if (!ownership.ok) {
      return ownership
    }
    current = target
    hops += 1
  }

  if (hops > 1) {
    return err(
      new UrlInvariantError(
        DOMAIN_ERROR_CODE.URL_REDIRECT_CHAIN,
        "Redirect graph must contain only one-hop redirects",
        source.id.value,
      ),
    )
  }
  switch (current.state) {
    case "active":
      return ok(null)
    case "gone":
    case "reserved":
      return err(
        new UrlInvariantError(
          DOMAIN_ERROR_CODE.URL_REDIRECT_TARGET_NOT_ACTIVE,
          "Redirect target must be active",
          source.id.value,
        ),
      )
    default:
      return assertNever(current)
  }
}

export function validateRedirectGraph(registry: UrlRegistry): DomainResult<UrlRegistry> {
  for (const [index, route] of registry.routes.entries()) {
    for (const candidate of registry.routes.slice(index + 1)) {
      if (route.id.value === candidate.id.value) {
        return err(
          new UrlInvariantError(
            DOMAIN_ERROR_CODE.URL_ID_COLLISION,
            "URL identifiers must be unique",
            route.id.value,
          ),
        )
      }
      if (route.key.value === candidate.key.value) {
        return err(
          new UrlInvariantError(
            DOMAIN_ERROR_CODE.URL_UNIQUE_KEY_COLLISION,
            "Normalized URL keys must be unique",
            route.key.value,
          ),
        )
      }
    }
    switch (route.state) {
      case "active":
      case "gone":
      case "reserved":
        break
      case "redirected": {
        const redirect = validateRedirect(registry, route)
        if (!redirect.ok) {
          return redirect
        }
        break
      }
      default:
        return assertNever(route)
    }
  }
  return ok(registry)
}

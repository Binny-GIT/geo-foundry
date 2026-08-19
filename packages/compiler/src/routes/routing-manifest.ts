import { CompilerError, COMPILER_ERROR } from "../compile/errors.js"
import { canonicalDomainOf } from "../seo/urls.js"

export type RoutingManifestHost = {
  readonly canonical: boolean
  readonly host: string
  readonly siteId: string
}

export type RoutingManifest = {
  readonly hosts: readonly RoutingManifestHost[]
  readonly schemaVersion: 1
}

export type RoutingManifestSiteInput = {
  readonly canonicalDomain: string
  readonly hostAliases?: readonly string[]
  readonly siteId: string
}

/**
 * Global host table across every site of the release: each normalized host
 * (canonical domains plus aliases) resolves to exactly one site and carries
 * whether it is that site's canonical host. The manifest is content for CAS
 * publication - it is derived purely from validated inputs and sorted by
 * host, so identical site sets always produce an identical manifest.
 */
export const buildRoutingManifest = (
  sites: readonly RoutingManifestSiteInput[],
): RoutingManifest => {
  const byHost = new Map<string, RoutingManifestHost>()
  const claim = (rawHost: string, siteId: string, canonical: boolean): void => {
    let host: string
    try {
      host = canonicalDomainOf({ canonicalDomain: rawHost })
    } catch {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_HOST_INVALID,
        `host "${rawHost}" of site ${siteId} is not a bare hostname`,
      )
    }
    const existing = byHost.get(host)
    if (existing !== undefined) {
      throw new CompilerError(
        COMPILER_ERROR.ROUTE_HOST_CONFLICT,
        `host ${host} is claimed by site ${existing.siteId} and site ${siteId}`,
      )
    }
    byHost.set(host, { canonical, host, siteId })
  }
  for (const site of [...sites].sort((left, right) => left.siteId.localeCompare(right.siteId))) {
    claim(site.canonicalDomain, site.siteId, true)
    for (const alias of [...(site.hostAliases ?? [])].sort()) {
      claim(alias, site.siteId, false)
    }
  }
  return {
    hosts: [...byHost.values()].sort((left, right) => left.host.localeCompare(right.host)),
    schemaVersion: 1,
  }
}

export const siteIdOfHost = (manifest: RoutingManifest, host: string): RoutingManifestHost | null =>
  manifest.hosts.find((entry) => entry.host === host) ?? null

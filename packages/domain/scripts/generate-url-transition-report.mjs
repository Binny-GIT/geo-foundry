import { mkdir, writeFile } from "node:fs/promises"

import {
  createUrlRegistry,
  normalizePathname,
  parseContentId,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  publishUrl,
  renameUrl,
  requireSitemapEligible,
  reserveUrl,
  retainActiveUrlForContentUpdate,
  validateRedirectGraph,
} from "@geo/domain"

function unwrap(result) {
  if (!result.ok) {
    throw result.error
  }
  return result.value
}

function requireErrorCode(result, expectedCode) {
  if (result.ok) {
    throw new TypeError("Expected a failed domain result")
  }
  if (result.error.code !== expectedCode) {
    throw new TypeError(`Expected ${expectedCode}, received ${result.error.code}`)
  }
  return result.error.code
}

const contentId = unwrap(parseContentId("content-manual"))
const tenantId = unwrap(parseTenantId("tenant-manual"))
const siteId = unwrap(parseSiteId("site-manual"))
const otherTenantId = unwrap(parseTenantId("tenant-other"))
const otherSiteId = unwrap(parseSiteId("site-other"))
const firstUrlId = unwrap(parseUrlId("url-manual-first"))
const secondUrlId = unwrap(parseUrlId("url-manual-second"))
const thirdUrlId = unwrap(parseUrlId("url-manual-third"))
const ownership = Object.freeze({ scope: "site", siteId, tenantId })
const otherSiteOwnership = Object.freeze({ scope: "site", siteId: otherSiteId, tenantId })
const otherTenantOwnership = Object.freeze({ scope: "site", siteId, tenantId: otherTenantId })

const empty = unwrap(createUrlRegistry({ reservedPathnames: ["/admin", "/api"] }))
const reserved = unwrap(
  reserveUrl(empty, {
    contentId,
    expectedRevision: 0,
    locale: "en-US",
    ownership,
    pathname: "/guides/geo-foundry",
    urlId: firstUrlId,
  }),
)
const published = unwrap(
  publishUrl(reserved.registry, {
    expectedRevision: 1,
    hostname: "site-a.test",
    urlId: firstUrlId,
  }),
)
const retained = unwrap(retainActiveUrlForContentUpdate(published.registry, { urlId: firstUrlId }))
const renamed = unwrap(
  renameUrl(published.registry, {
    expectedRevision: 2,
    hostname: "site-a.test",
    locale: "en-US",
    pathname: "/guides/geo-foundry-platform",
    sourceUrlId: firstUrlId,
    targetOwnership: ownership,
    targetUrlId: secondUrlId,
  }),
)
const redirectCountBefore = renamed.registry.routes.filter(
  (route) => route.state === "redirected",
).length
const registryBytesBefore = JSON.stringify(renamed.registry)
const registryValueBefore = Object.freeze({
  activePathname: renamed.active.pathname.value,
  redirectCount: redirectCountBefore,
  revision: renamed.registry.revision,
  routeCount: renamed.registry.routes.length,
})
const secondRename = renameUrl(renamed.registry, {
  expectedRevision: 3,
  hostname: "site-a.test",
  locale: "en-US",
  pathname: "/guides/geo-foundry-v2",
  sourceUrlId: secondUrlId,
  targetOwnership: ownership,
  targetUrlId: thirdUrlId,
})
const registryValueAfter = Object.freeze({
  activePathname: renamed.active.pathname.value,
  redirectCount: renamed.registry.routes.filter((route) => route.state === "redirected").length,
  revision: renamed.registry.revision,
  routeCount: renamed.registry.routes.length,
})
const registryBytesUnchanged = JSON.stringify(renamed.registry) === registryBytesBefore
const registryValueUnchanged =
  registryValueAfter.activePathname === registryValueBefore.activePathname &&
  registryValueAfter.redirectCount === registryValueBefore.redirectCount &&
  registryValueAfter.revision === registryValueBefore.revision &&
  registryValueAfter.routeCount === registryValueBefore.routeCount
if (!registryBytesUnchanged || !registryValueUnchanged || redirectCountBefore !== 1) {
  throw new TypeError("URL rename acceptance snapshot changed")
}

const loopTarget = Object.freeze({
  ...renamed.active,
  state: "redirected",
  statusCode: 301,
  targetUrlId: secondUrlId,
})
const loopRegistry = Object.freeze({
  ...renamed.registry,
  routes: Object.freeze(
    renamed.registry.routes.map((route) =>
      route.id.value === loopTarget.id.value ? loopTarget : route,
    ),
  ),
})

const report = Object.freeze({
  generator: Object.freeze({
    command: "pnpm --filter @geo/domain test:url-contract",
    packageSurface: "@geo/domain",
  }),
  fixture: Object.freeze({
    hostname: "site-a.test",
    locale: "en-US",
    siteId: siteId.value,
    tenantId: tenantId.value,
  }),
  happy: Object.freeze({
    firstRename: Object.freeze({
      activePathname: renamed.active.pathname.value,
      graphValid: unwrap(validateRedirectGraph(renamed.registry)) === renamed.registry,
      redirectCount: redirectCountBefore,
      redirectStatus: renamed.redirect.statusCode,
      redirectTarget: renamed.redirect.targetUrlId.value,
    }),
    stableContentUpdate: Object.freeze({
      canonicalAfter: retained.canonicalUrl.value,
      canonicalBefore: published.active.canonicalUrl.value,
      pathnameAfter: retained.pathname.value,
      pathnameBefore: published.active.pathname.value,
      sameActiveRoute: retained === published.active,
    }),
  }),
  failures: Object.freeze({
    crossSite: requireErrorCode(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-b.test",
        locale: "en-US",
        pathname: "/guides/cross-site",
        sourceUrlId: firstUrlId,
        targetOwnership: otherSiteOwnership,
        targetUrlId: secondUrlId,
      }),
      "URL_REDIRECT_CROSS_SITE",
    ),
    crossTenant: requireErrorCode(
      renameUrl(published.registry, {
        expectedRevision: 2,
        hostname: "site-a.test",
        locale: "en-US",
        pathname: "/guides/cross-tenant",
        sourceUrlId: firstUrlId,
        targetOwnership: otherTenantOwnership,
        targetUrlId: secondUrlId,
      }),
      "URL_REDIRECT_CROSS_TENANT",
    ),
    draftSitemap: requireErrorCode(
      requireSitemapEligible(reserved.reserved),
      "URL_SITEMAP_DRAFT_INELIGIBLE",
    ),
    encodedSeparator: requireErrorCode(
      normalizePathname("/guides%2Fhidden"),
      "URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS",
    ),
    loop: requireErrorCode(validateRedirectGraph(loopRegistry), "URL_REDIRECT_LOOP"),
    normalizedCollision: requireErrorCode(
      reserveUrl(published.registry, {
        contentId,
        expectedRevision: 2,
        locale: "en-US",
        ownership,
        pathname: "/guides/geo-foundry/",
        urlId: thirdUrlId,
      }),
      "URL_UNIQUE_KEY_COLLISION",
    ),
    secondRename: Object.freeze({
      code: requireErrorCode(secondRename, "URL_REDIRECT_CHAIN"),
      redirectCountAfter: registryValueAfter.redirectCount,
      redirectCountBefore: registryValueBefore.redirectCount,
      registryBytesUnchanged,
      registryValueUnchanged,
      revisionAfter: registryValueAfter.revision,
      revisionBefore: registryValueBefore.revision,
      routeCountAfter: registryValueAfter.routeCount,
      routeCountBefore: registryValueBefore.routeCount,
    }),
  }),
})

const evidenceDirectory = new URL("../../../.omo/evidence/task-5/", import.meta.url)
const outputUrl = new URL("url-transition-report.json", evidenceDirectory)
await mkdir(evidenceDirectory, { recursive: true })
await writeFile(outputUrl, `${JSON.stringify(report, null, 2)}\n`, "utf8")

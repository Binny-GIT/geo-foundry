import { describe, expect, it } from "vitest"

import {
  buildSiteHostIndex,
  normalizeSiteHost,
  resolveSiteHost,
  SITE_HOST_ROLE,
  validateTimezone,
  type SiteHostRegistration,
} from "../src/index.js"
import { parseSiteId, parseTenantId } from "../src/index.js"
import type { DomainError } from "../src/index.js"

const registration = (
  hostname: string,
  siteId: string,
  tenantId: string,
  role: (typeof SITE_HOST_ROLE)[keyof typeof SITE_HOST_ROLE] = SITE_HOST_ROLE.CANONICAL,
): SiteHostRegistration => {
  const host = normalizeSiteHost(hostname)
  const site = parseSiteId(siteId)
  const tenant = parseTenantId(tenantId)
  if (!host.ok || !site.ok || !tenant.ok) {
    throw new Error("invalid site host fixture")
  }
  return { siteId: site.value, tenantId: tenant.value, hostname: host.value, role }
}

const siteA = registration("site-a.test", "site-a", "tenant-a")
const siteAWww = registration("www.site-a.test", "site-a", "tenant-a", SITE_HOST_ROLE.ALIAS)
const siteB = registration("site-b.test", "site-b", "tenant-b")
const enabledBoth = ((): Map<string, boolean> => {
  const enabled = new Map<string, boolean>()
  enabled.set("site-a", true)
  enabled.set("site-b", true)
  return enabled
})()

describe("site host index", () => {
  it("Given unique registrations, when the index is built, then every normalized host maps to its site", () => {
    const index = buildSiteHostIndex([siteA, siteAWww, siteB])
    expect(index.ok).toBe(true)
    if (index.ok) {
      expect(index.value.size).toBe(3)
      expect(index.value.get("site-a.test")?.siteId.value).toBe("site-a")
    }
  })

  it("Given a mixed-case duplicate, when the index is built, then registration is rejected with SITE_HOST_CONFLICT", () => {
    const index = buildSiteHostIndex([siteA, registration("SITE-A.TEST", "site-x", "tenant-x")])
    expect(index.ok).toBe(false)
    if (!index.ok) {
      expect((index.error as DomainError).code).toBe("SITE_HOST_CONFLICT")
    }
  })

  it("Given a trailing-dot duplicate, when the index is built, then registration is rejected", () => {
    const index = buildSiteHostIndex([siteA, registration("site-a.test.", "site-x", "tenant-x")])
    expect(index.ok).toBe(false)
  })

  it("Given cross-tenant host reuse, when the index is built, then registration is rejected", () => {
    const index = buildSiteHostIndex([siteA, registration("site-a.test", "site-x", "tenant-b")])
    expect(index.ok).toBe(false)
    if (!index.ok) {
      expect((index.error as DomainError).code).toBe("SITE_HOST_CONFLICT")
    }
  })
})

describe("deterministic host resolution", () => {
  it("Given an alias host, when resolved, then it maps to its site with the canonical host", () => {
    const index = buildSiteHostIndex([siteA, siteAWww, siteB])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, enabledBoth, "www.site-a.test")
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.value.siteId.value).toBe("site-a")
      expect(resolved.value.tenantId.value).toBe("tenant-a")
      expect(resolved.value.canonical.value).toBe("site-a.test")
      expect(resolved.value.matched.value).toBe("www.site-a.test")
    }
  })

  it("Given a canonical host, when resolved, then matched equals canonical", () => {
    const index = buildSiteHostIndex([siteA, siteAWww, siteB])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, enabledBoth, "site-b.test")
    if (!resolved.ok) {
      throw new Error("resolution fixture")
    }
    expect(resolved.value.canonical.value).toBe("site-b.test")
  })

  it("Given a mixed-case incoming host, when resolved, then it matches case-insensitively", () => {
    const index = buildSiteHostIndex([siteA, siteAWww])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, enabledBoth, "WWW.SITE-A.TEST.")
    expect(resolved.ok).toBe(true)
  })

  it("Given an unknown host, when resolved, then it fails with SITE_UNKNOWN_HOST", () => {
    const index = buildSiteHostIndex([siteA])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, enabledBoth, "unknown.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect((resolved.error as DomainError).code).toBe("SITE_UNKNOWN_HOST")
    }
  })

  it("Given a disabled site, when resolved, then it fails with SITE_DISABLED", () => {
    const index = buildSiteHostIndex([siteA])
    const disabled = new Map<string, boolean>([["site-a", false]])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, disabled, "site-a.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect((resolved.error as DomainError).code).toBe("SITE_DISABLED")
    }
  })

  it("Given a site missing from the status map, when resolved, then it fails closed as disabled", () => {
    const index = buildSiteHostIndex([siteA])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, new Map(), "site-a.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect((resolved.error as DomainError).code).toBe("SITE_DISABLED")
    }
  })

  it("Given a site without any canonical host, when resolved, then it fails with SITE_CANONICAL_MISSING", () => {
    const aliasOnly = registration("only-alias.test", "site-c", "tenant-a", SITE_HOST_ROLE.ALIAS)
    const index = buildSiteHostIndex([aliasOnly])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const enabled = new Map<string, boolean>([["site-c", true]])
    const resolved = resolveSiteHost(index.value, enabled, "only-alias.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect((resolved.error as DomainError).code).toBe("SITE_CANONICAL_MISSING")
    }
  })

  it("Given an invalid host input, when resolved, then it fails with URL_INVALID_HOSTNAME", () => {
    const index = buildSiteHostIndex([siteA])
    if (!index.ok) {
      throw new Error("index fixture")
    }
    const resolved = resolveSiteHost(index.value, enabledBoth, "http://bad.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect((resolved.error as DomainError).code).toBe("URL_INVALID_HOSTNAME")
    }
  })
})

describe("timezone validation", () => {
  it("Given canonical IANA zones, when validated, then they pass", () => {
    for (const zone of ["UTC", "Asia/Shanghai", "Europe/Berlin", "America/New_York"]) {
      expect(validateTimezone(zone).ok).toBe(true)
    }
  })

  it("Given a non-canonical or unknown zone, when validated, then it fails with SITE_INVALID_TIMEZONE", () => {
    for (const zone of ["asia/shanghai", "Not/AZone", "", "  UTC  "]) {
      const result = validateTimezone(zone)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect((result.error as DomainError).code).toBe("SITE_INVALID_TIMEZONE")
      }
    }
  })

  it("Given a non-string value, when validated, then it fails", () => {
    expect(validateTimezone(42).ok).toBe(false)
    expect(validateTimezone(null).ok).toBe(false)
  })
})

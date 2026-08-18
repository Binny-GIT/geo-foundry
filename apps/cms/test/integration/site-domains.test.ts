import {
  buildSiteHostIndex,
  normalizeSiteHost,
  parseSiteId,
  parseTenantId,
  resolveSiteHost,
  SITE_HOST_ROLE,
  type SiteHostRegistration,
} from "@geo/domain"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Domain, Site, Tenant, User } from "../../src/payload-types"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const registrationFrom = (domain: Domain): SiteHostRegistration => {
  const hostname = normalizeSiteHost(domain.hostname)
  const siteId = parseSiteId(String(domain.site))
  const tenantId = parseTenantId(String(domain.tenant))
  if (!hostname.ok || !siteId.ok || !tenantId.ok) {
    throw new Error("invalid stored domain fixture")
  }
  return {
    hostname: hostname.value,
    siteId: siteId.value,
    tenantId: tenantId.value,
    role: domain.role === "canonical" ? SITE_HOST_ROLE.CANONICAL : SITE_HOST_ROLE.ALIAS,
  }
}

const storedDomains = async (payload: Payload): Promise<readonly Domain[]> =>
  (await payload.find({ collection: "domains", limit: 100, overrideAccess: true, depth: 0 }))
    .docs as Domain[]

describe("site and domain configuration integration", () => {
  let payload: Payload
  let tenantA: Tenant
  let tenantB: Tenant
  let superAdmin: User
  let tenantAAdmin: User
  let tenantBAdmin: User
  let siteA: Site
  let siteB: Site

  beforeAll(async () => {
    payload = await getPayload({ config })
    await payload.delete({ collection: "domains", where: {}, overrideAccess: true })
    await payload.delete({ collection: "sites", where: {}, overrideAccess: true })
    await payload.delete({ collection: "users", where: {}, overrideAccess: true })
    await payload.delete({ collection: "tenants", where: {}, overrideAccess: true })

    superAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User

    tenantA = await payload.create({
      collection: "tenants",
      data: { name: "site-tenant-a" },
      ...asUser(superAdmin),
    })
    tenantB = await payload.create({
      collection: "tenants",
      data: { name: "site-tenant-b" },
      ...asUser(superAdmin),
    })

    tenantAAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-a@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantA.id,
      },
      ...asUser(superAdmin),
    })) as User
    tenantBAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-b@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantB.id,
      },
      ...asUser(superAdmin),
    })) as User

    siteA = await payload.create({
      collection: "sites",
      data: {
        name: "Site A",
        tenant: tenantA.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAAdmin),
    })
    siteB = await payload.create({
      collection: "sites",
      data: {
        name: "Site B",
        tenant: tenantB.id,
        locale: "sv-SE",
        timezone: "Europe/Stockholm",
        status: "active",
      },
      ...asUser(tenantBAdmin),
    })

    await payload.create({
      collection: "domains",
      data: {
        hostname: "site-a.test",
        site: siteA.id,
        tenant: tenantA.id,
        role: "canonical",
        status: "active",
      },
      ...asUser(tenantAAdmin),
    })
    await payload.create({
      collection: "domains",
      data: {
        hostname: "www.site-a.test",
        site: siteA.id,
        tenant: tenantA.id,
        role: "alias",
        status: "active",
      },
      ...asUser(tenantAAdmin),
    })
    await payload.create({
      collection: "domains",
      data: {
        hostname: "site-b.test",
        site: siteB.id,
        tenant: tenantB.id,
        role: "canonical",
        status: "active",
      },
      ...asUser(tenantBAdmin),
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: "domains", where: {}, overrideAccess: true })
    await payload.delete({ collection: "sites", where: {}, overrideAccess: true })
    await payload.delete({ collection: "users", where: {}, overrideAccess: true })
    await payload.delete({ collection: "tenants", where: {}, overrideAccess: true })
    await payload.destroy()
  })

  it("Given stored domains, when the host index is built from live rows, then alias hosts resolve to their canonical site host", async () => {
    const index = buildSiteHostIndex((await storedDomains(payload)).map(registrationFrom))
    if (!index.ok) {
      throw new Error(index.error.message)
    }
    const enabled = new Map<string, boolean>([
      [String(siteA.id), true],
      [String(siteB.id), true],
    ])
    const resolved = resolveSiteHost(index.value, enabled, "www.site-a.test")
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.value.siteId.value).toBe(String(siteA.id))
      expect(resolved.value.tenantId.value).toBe(String(tenantA.id))
      expect(resolved.value.canonical.value).toBe("site-a.test")
    }
    const canonical = resolveSiteHost(index.value, enabled, "site-b.test")
    if (!canonical.ok) {
      throw new Error(canonical.error.message)
    }
    expect(canonical.value.canonical.value).toBe("site-b.test")
  })

  it("Given a mixed-case duplicate hostname, when created, then normalization rejects the collision", async () => {
    await expect(
      payload.create({
        collection: "domains",
        data: {
          hostname: "SITE-A.TEST",
          site: siteB.id,
          tenant: tenantB.id,
          role: "canonical",
          status: "active",
        },
        ...asUser(tenantBAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given a trailing-dot duplicate hostname, when created, then the normalized value collides and is rejected", async () => {
    await expect(
      payload.create({
        collection: "domains",
        data: {
          hostname: "site-a.test.",
          site: siteB.id,
          tenant: tenantB.id,
          role: "canonical",
          status: "active",
        },
        ...asUser(tenantBAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given a domain for another tenant's site, when created, then the site/tenant mismatch is rejected", async () => {
    await expect(
      payload.create({
        collection: "domains",
        data: {
          hostname: "mismatch.test",
          site: siteA.id,
          tenant: tenantB.id,
          role: "canonical",
          status: "active",
        },
        ...asUser(tenantBAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given an invalid locale or timezone, when a site is created, then validation rejects it", async () => {
    await expect(
      payload.create({
        collection: "sites",
        data: {
          name: "Bad Locale",
          tenant: tenantA.id,
          locale: "not-a-locale!",
          timezone: "UTC",
          status: "active",
        },
        ...asUser(tenantAAdmin),
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: "sites",
        data: {
          name: "Bad Timezone",
          tenant: tenantA.id,
          locale: "en-US",
          timezone: "Not/AZone",
          status: "active",
        },
        ...asUser(tenantAAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given a super-admin session, when creating a site is attempted, then the read-only baseline denies it", async () => {
    await expect(
      payload.create({
        collection: "sites",
        data: {
          name: "Super Admin Site",
          tenant: tenantA.id,
          locale: "en-US",
          timezone: "UTC",
          status: "active",
        },
        ...asUser(superAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given an unknown host, when resolved, then it fails with SITE_UNKNOWN_HOST", async () => {
    const index = buildSiteHostIndex((await storedDomains(payload)).map(registrationFrom))
    if (!index.ok) {
      throw new Error(index.error.message)
    }
    const enabled = new Map<string, boolean>([[String(siteA.id), true]])
    const resolved = resolveSiteHost(index.value, enabled, "unknown.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.error.code).toBe("SITE_UNKNOWN_HOST")
    }
  })

  it("Given a disabled site, when resolved, then it fails with SITE_DISABLED", async () => {
    const disabledSite = await payload.create({
      collection: "sites",
      data: {
        name: "Disabled Site",
        tenant: tenantA.id,
        locale: "en-US",
        timezone: "UTC",
        status: "disabled",
      },
      ...asUser(tenantAAdmin),
    })
    await payload.create({
      collection: "domains",
      data: {
        hostname: "disabled.test",
        site: disabledSite.id,
        tenant: tenantA.id,
        role: "canonical",
        status: "active",
      },
      ...asUser(tenantAAdmin),
    })
    const index = buildSiteHostIndex((await storedDomains(payload)).map(registrationFrom))
    if (!index.ok) {
      throw new Error(index.error.message)
    }
    const enabled = new Map<string, boolean>([
      [String(siteA.id), true],
      [String(siteB.id), true],
      [String(disabledSite.id), false],
    ])
    const resolved = resolveSiteHost(index.value, enabled, "disabled.test")
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.error.code).toBe("SITE_DISABLED")
    }
  })

  it("Given the Site model, when its persisted fields are inspected, then no credential-like fields exist", async () => {
    const persistedFieldNames = [
      "id",
      "name",
      "tenant",
      "locale",
      "timezone",
      "status",
      "contentStrategy",
      "qualityThresholds",
      "seoDefaults",
      "updatedAt",
      "createdAt",
    ]
    const secretPattern = /(secret|password|token|api[-_]?key|credential)/i
    for (const field of persistedFieldNames) {
      expect(secretPattern.test(field)).toBe(false)
    }
    const stored = await payload.findByID({
      collection: "sites",
      id: siteA.id,
      overrideAccess: true,
    })
    const serialized = JSON.stringify(stored)
    expect(secretPattern.test(serialized)).toBe(false)
  })
})

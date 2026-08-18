import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import {
  activateUrlRecord,
  markUrlRecordGone,
  renameUrlRecord,
  reserveUrlRecord,
  retainActiveUrl,
  runUrlRegistryOperation,
  sitemapEligibleUrls,
} from "../../src/services/url-registry"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

describe("URL registry lifecycle integration", () => {
  let payload: Payload
  let tenant: Tenant
  let siteA: Site
  let siteB: Site
  let superAdmin: User
  let tenantAdmin: User
  let editor: User
  let contentId: number

  beforeAll(async () => {
    payload = await getPayload({ config })
    for (const collection of [
      "url-records",
      "content-editions",
      "contents",
      "media",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }

    superAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User

    tenant = await payload.create({
      collection: "tenants",
      data: { name: "url-registry-tenant" },
      ...asUser(superAdmin),
    })

    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(superAdmin),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: {
        email: "editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User

    siteA = await payload.create({
      collection: "sites",
      data: {
        name: "URL Site A",
        tenant: tenant.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAdmin),
    })
    siteB = await payload.create({
      collection: "sites",
      data: {
        name: "URL Site B",
        tenant: tenant.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAdmin),
    })

    const content = await payload.create({
      collection: "contents",
      data: {
        topic: "URL lifecycle",
        intent: "Prove registry transactions",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })
    contentId = content.id
  })

  afterAll(async () => {
    for (const collection of [
      "url-records",
      "content-editions",
      "contents",
      "media",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await payload.destroy()
  })

  it("Given a reserved URL, when activated, then it is active with a canonical URL and sitemap eligible", async () => {
    const recordId = await reserveUrlRecord(payload, {
      contentId,
      locale: "en-US",
      pathname: "/articles/ai-support",
      siteId: siteA.id,
      tenantId: tenant.id,
    })
    await activateUrlRecord(payload, recordId, "site-a.test")

    const stored = await payload.findByID({
      collection: "url-records",
      id: recordId,
      depth: 0,
      overrideAccess: true,
    })
    expect(stored.state).toBe("active")
    expect(stored.canonicalUrl).toBe("https://site-a.test/en-US/articles/ai-support")

    const eligible = await sitemapEligibleUrls(payload, siteA.id)
    expect(eligible).toEqual([
      {
        canonicalUrl: "https://site-a.test/en-US/articles/ai-support",
        locale: "en-US",
        pathname: "/articles/ai-support",
      },
    ])
  })

  it("Given an active URL, when content is updated, then the URL is retained unchanged", async () => {
    const stored = await payload.find({
      collection: "url-records",
      where: { pathname: { equals: "/articles/ai-support" } },
      depth: 0,
      overrideAccess: true,
    })
    const recordId = stored.docs[0]?.id
    if (recordId === undefined) {
      throw new Error("active record fixture missing")
    }
    const retained = await retainActiveUrl(payload, recordId)
    expect(retained.pathname.value).toBe("/articles/ai-support")
    expect(retained.state).toBe("active")
  })

  it("Given an approved slug change, when renamed, then exactly one hop redirect and a new active record exist atomically", async () => {
    const stored = await payload.find({
      collection: "url-records",
      where: { pathname: { equals: "/articles/ai-support" } },
      depth: 0,
      overrideAccess: true,
    })
    const sourceId = stored.docs[0]?.id
    if (sourceId === undefined) {
      throw new Error("source record fixture missing")
    }

    const { activeId, redirectId } = await renameUrlRecord(payload, {
      locale: "en-US",
      pathname: "/articles/ai-support-v2",
      recordId: sourceId,
    })

    expect(redirectId).toBe(sourceId)
    const redirect = await payload.findByID({
      collection: "url-records",
      id: redirectId,
      depth: 0,
      overrideAccess: true,
    })
    const active = await payload.findByID({
      collection: "url-records",
      id: activeId,
      depth: 0,
      overrideAccess: true,
    })
    expect(redirect.state).toBe("redirected")
    expect(redirect.statusCode).toBe(301)
    expect(redirect.targetUrl).toBe(activeId)
    expect(active.state).toBe("active")
    expect(active.pathname).toBe("/articles/ai-support-v2")
    expect(active.canonicalUrl).toBe("https://site-a.test/en-US/articles/ai-support-v2")

    const eligible = await sitemapEligibleUrls(payload, siteA.id)
    expect(eligible.map((entry) => entry.pathname)).toEqual(["/articles/ai-support-v2"])
  })

  it("Given a second rename of the redirect target, when attempted, then a redirect chain is rejected without state change", async () => {
    const activeDoc = await payload.find({
      collection: "url-records",
      where: { pathname: { equals: "/articles/ai-support-v2" } },
      depth: 0,
      overrideAccess: true,
    })
    const activeId = activeDoc.docs[0]?.id
    if (activeId === undefined) {
      throw new Error("active record fixture missing")
    }

    await expect(
      renameUrlRecord(payload, {
        locale: "en-US",
        pathname: "/articles/ai-support-v3",
        recordId: activeId,
      }),
    ).rejects.toThrow(/URL_REDIRECT_CHAIN/)

    const unchanged = await payload.findByID({
      collection: "url-records",
      id: activeId,
      depth: 0,
      overrideAccess: true,
    })
    expect(unchanged.state).toBe("active")
    const all = await payload.find({
      collection: "url-records",
      where: { site: { equals: siteA.id } },
      depth: 0,
      overrideAccess: true,
    })
    expect(all.docs.filter((doc) => doc.pathname.includes("ai-support")).length).toBe(2)
  })

  it("Given two concurrent reservations of the same normalized key, when both run, then exactly one winner commits", async () => {
    const attempts = await Promise.allSettled([
      reserveUrlRecord(payload, {
        contentId,
        locale: "en-US",
        pathname: "/articles/concurrent",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
      reserveUrlRecord(payload, {
        contentId,
        locale: "en-US",
        pathname: "/articles/concurrent",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
    ])
    const winners = attempts.filter((attempt) => attempt.status === "fulfilled")
    expect(winners.length).toBe(1)

    const rows = await payload.find({
      collection: "url-records",
      where: { pathname: { equals: "/articles/concurrent" } },
      depth: 0,
      overrideAccess: true,
    })
    expect(rows.docs.length).toBe(1)
    expect(rows.docs[0]?.state).toBe("reserved")
  })

  it("Given a sequential duplicate reservation, when attempted, then the unique key collision is rejected", async () => {
    await expect(
      reserveUrlRecord(payload, {
        contentId,
        locale: "en-US",
        pathname: "/articles/concurrent",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
    ).rejects.toThrow(/URL_UNIQUE_KEY_COLLISION/)
  })

  it("Given the same pathname on another site, when reserved, then the per-site namespace accepts it", async () => {
    const recordId = await reserveUrlRecord(payload, {
      contentId,
      locale: "en-US",
      pathname: "/articles/concurrent",
      siteId: siteB.id,
      tenantId: tenant.id,
    })
    expect(recordId).toBeGreaterThan(0)
  })

  it("Given an invalid locale or pathname, when reserved, then boundary validation rejects it", async () => {
    await expect(
      reserveUrlRecord(payload, {
        contentId,
        locale: "not-a-locale!",
        pathname: "/articles/bad-locale",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
    ).rejects.toThrow(/URL_INVALID_LOCALE/)
    await expect(
      reserveUrlRecord(payload, {
        contentId,
        locale: "en-US",
        pathname: "/articles/bad-path?q=1",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
    ).rejects.toThrow(/URL_PATH_QUERY_OR_FRAGMENT/)
  })

  it("Given a reserved route pathname, when reserved, then the collision is rejected", async () => {
    await expect(
      reserveUrlRecord(payload, {
        contentId,
        locale: "en-US",
        pathname: "/api",
        siteId: siteA.id,
        tenantId: tenant.id,
      }),
    ).rejects.toThrow(/URL_RESERVED_ROUTE_COLLISION/)
  })

  it("Given a transaction that fails after writing, when rolled back, then no partial row survives", async () => {
    const before = await payload.count({ collection: "url-records" })
    await expect(
      runUrlRegistryOperation(payload, siteA.id, async (_registry, req) => {
        await payload.create({
          collection: "url-records",
          data: {
            site: siteA.id,
            tenant: tenant.id,
            content: contentId,
            locale: "en-US",
            pathname: "/articles/doomed",
            uniqueKey: `${siteA.id}:en-US:/articles/doomed`,
            state: "reserved",
            revision: 0,
          },
          depth: 0,
          overrideAccess: true,
          req,
        })
        throw new Error("simulated interruption")
      }),
    ).rejects.toThrow(/simulated interruption/)
    const after = await payload.count({ collection: "url-records" })
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it("Given an active URL, when marked gone, then it is gone and leaves the sitemap", async () => {
    const activeDoc = await payload.find({
      collection: "url-records",
      where: { pathname: { equals: "/articles/ai-support-v2" } },
      depth: 0,
      overrideAccess: true,
    })
    const recordId = activeDoc.docs[0]?.id
    if (recordId === undefined) {
      throw new Error("active record fixture missing")
    }
    await markUrlRecordGone(payload, recordId)
    const gone = await payload.findByID({
      collection: "url-records",
      id: recordId,
      depth: 0,
      overrideAccess: true,
    })
    expect(gone.state).toBe("gone")

    const eligible = await sitemapEligibleUrls(payload, siteA.id)
    expect(eligible.length).toBe(0)
  })
})

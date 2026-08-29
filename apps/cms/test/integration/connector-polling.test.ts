import { sql } from "@payloadcms/db-postgres"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import { pollDueRssConnectors } from "../../src/services/connector-polling"

const enqueue = vi.hoisted(() => vi.fn(async () => "intake-job"))

vi.mock("../../src/services/intake-queue", () => ({
  enqueueIntakeFetchFromEnvironment: enqueue,
}))

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

describe("RSS connector polling", () => {
  let payload: Payload
  let tenant: Tenant
  let tenantAdmin: User
  let serviceUser: User
  let site: Site

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of ["intake-items", "connectors", "sites", "users", "tenants"] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    const bootstrap = (await payload.create({
      collection: "users",
      data: { email: "rss-poll-boot@geo-foundry.test", password: "bootstrap-password", role: "editor" },
    })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "rss-poll-tenant" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: { email: "rss-poll-admin@geo-foundry.test", password: "admin-password", role: "tenant-admin", tenant: tenant.id },
      ...asUser(bootstrap),
    })) as User
    serviceUser = (await payload.create({
      collection: "users",
      data: { email: "rss-poll-service@geo-foundry.test", password: "service-password", role: "content-service", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "RSS Poll Site", status: "active", tenant: tenant.id, timezone: "UTC" },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    await payload.db.drizzle.execute(sql`
      TRUNCATE TABLE
        "geo_foundry"."intake_items",
        "geo_foundry"."connectors",
        "geo_foundry"."sites",
        "geo_foundry"."users",
        "geo_foundry"."tenants"
      RESTART IDENTITY CASCADE
    `)
    await payload.destroy()
  })

  it("polls an active RSS connector once, reuses its parent, and honors the hourly lease", async () => {
    enqueue.mockClear()
    const connector = await payload.create({
      collection: "connectors",
      data: { name: "RSS Poll Connector", site: site.id, sourceEndpoint: "https://feed.test/rss.xml", status: "active", tenant: tenant.id, type: "rss" },
      ...asUser(tenantAdmin),
    })
    const first = await pollDueRssConnectors(payload, { now: "2026-08-28T00:00:00.000Z" })
    expect(first.polled).toEqual([connector.id])
    expect(enqueue).toHaveBeenCalledTimes(1)
    const parents = await payload.find({
      collection: "intake-items",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { and: [{ connector: { equals: connector.id } }, { channel: { equals: "rss" } }] },
    })
    expect(parents.docs).toHaveLength(1)
    expect(parents.docs[0]).toMatchObject({ status: "fetching" })
    const stored = await payload.findByID({ collection: "connectors", depth: 0, id: connector.id, overrideAccess: true })
    expect(stored.lastPolledAt).toBe("2026-08-28T00:00:00.000Z")

    const second = await pollDueRssConnectors(payload, { now: "2026-08-28T00:30:00.000Z" })
    expect(second.polled).toEqual([])
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it("records a missing endpoint without queueing work", async () => {
    enqueue.mockClear()
    const connector = await payload.create({
      collection: "connectors",
      data: { name: "RSS Missing Endpoint", site: site.id, status: "active", tenant: tenant.id, type: "rss" },
      ...asUser(tenantAdmin),
    })
    const report = await pollDueRssConnectors(payload, { now: "2026-08-28T02:00:00.000Z" })
    expect(report.skipped).toContainEqual({ connectorId: connector.id, reason: "RSS_POLL_ENDPOINT_MISSING" })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("does not schedule a connector whose RSS parent is already fetching", async () => {
    enqueue.mockClear()
    const connector = await payload.create({
      collection: "connectors",
      data: { name: "RSS In Flight", site: site.id, sourceEndpoint: "https://feed.test/in-flight.xml", status: "active", tenant: tenant.id, type: "rss" },
      ...asUser(tenantAdmin),
    })
    await payload.create({
      collection: "intake-items",
      data: { channel: "rss", connector: connector.id, duplicateStatus: "unique", status: "fetching", tenant: tenant.id, title: "RSS: RSS In Flight" },
      depth: 0,
      draft: true,
      overrideAccess: true,
      user: serviceUser,
    })
    const report = await pollDueRssConnectors(payload, { now: "2026-08-28T03:00:00.000Z" })
    expect(report.skipped).toContainEqual({ connectorId: connector.id, reason: "RSS_POLL_FETCH_IN_FLIGHT" })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

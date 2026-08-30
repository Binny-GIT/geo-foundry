import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import { adoptIntakeItem } from "../../src/services/intake"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

describe("intake adoption", () => {
  let payload: Payload
  let tenant: Tenant
  let tenantAdmin: User
  let editor: User
  let site: Site

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "article-sources",
      "intake-items",
      "content-editions",
      "contents",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    const bootstrap = (await payload.create({
      collection: "users",
      data: { email: "intake-adoption-boot@geo-foundry.test", password: "bootstrap-password", role: "editor" },
    })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "intake-adoption-tenant" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: { email: "intake-adoption-admin@geo-foundry.test", password: "admin-password", role: "tenant-admin", tenant: tenant.id },
      ...asUser(bootstrap),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: { email: "intake-adoption-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "Intake adoption site", status: "active", tenant: tenant.id, timezone: "UTC" },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "article-sources",
      "intake-items",
      "content-editions",
      "contents",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await payload.destroy()
  })

  it("creates a compiler-valid citation from the adopted source URL", async () => {
    const intake = await payload.create({
      collection: "intake-items",
      data: {
        channel: "url",
        duplicateStatus: "unique",
        sourceUrl: "https://example.com/adoption",
        status: "ready",
        suggestedSite: site.id,
        summary: "Source summary",
        tenant: tenant.id,
        title: "Source title",
      },
      draft: true,
      ...asUser(editor),
    })

    const outcome = await adoptIntakeItem(payload, { intakeItemId: intake.id, user: editor })
    const edition = await payload.findByID({
      collection: "content-editions",
      depth: 0,
      draft: true,
      id: outcome.editionId,
      overrideAccess: true,
    })
    expect(edition).toMatchObject({
      citations: [{ id: `intake-${intake.id}`, title: "Source title", url: "https://example.com/adoption" }],
      workflowStatus: "draft",
    })
  })
})

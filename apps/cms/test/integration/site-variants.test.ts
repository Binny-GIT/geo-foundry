import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import { createSiteVariant } from "../../src/services/site-variants"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run() } catch (error) { return (error as { code?: string }).code ?? String(error) }
  throw new Error("expected failure")
}

describe("cross-site content variants", () => {
  let payload: Payload
  let tenant: Tenant
  let admin: User
  let editor: User
  let siteA: Site
  let siteB: Site
  let editionId: number

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of ["article-sources", "intake-items", "content-editions", "contents", "sites", "users", "tenants"] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    const bootstrap = (await payload.create({ collection: "users", data: { email: "variant-bootstrap@geo-foundry.test", password: "bootstrap-password", role: "editor" } })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "variant-tenant" }, ...asUser(bootstrap) })
    admin = (await payload.create({ collection: "users", data: { email: "variant-admin@geo-foundry.test", password: "tenant-admin-password", role: "tenant-admin", tenant: tenant.id }, ...asUser(bootstrap) })) as User
    editor = (await payload.create({ collection: "users", data: { email: "variant-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id }, ...asUser(admin) })) as User
    siteA = await payload.create({ collection: "sites", data: { locale: "en-US", name: "Variant Site A", status: "active", tenant: tenant.id, timezone: "UTC" }, ...asUser(admin) })
    siteB = await payload.create({ collection: "sites", data: { locale: "en-US", name: "Variant Site B", status: "active", tenant: tenant.id, timezone: "UTC" }, ...asUser(admin) })
    const content = await payload.create({ collection: "contents", data: { createdBy: "human", intent: "variant coverage", tenant: tenant.id, topic: "Variant topic" }, ...asUser(editor) })
    const edition = await payload.create({
      collection: "content-editions",
      draft: true,
      data: {
        angle: "Site A angle",
        body: [{ blockType: "paragraph", text: "Reusable source content." }],
        citations: [{ id: "citation-1", title: "Source", url: "https://source.test/article" }],
        content: content.id,
        creationOrigin: "human",
        entities: [{ id: "entity-1", name: "Geo Foundry", type: "Organization" }],
        primaryTopic: "Variant topic",
        secondaryTopics: ["GEO"],
        site: siteA.id,
        summary: "Source edition summary.",
        tenant: tenant.id,
        title: "Source edition",
      },
      ...asUser(editor),
    })
    editionId = edition.id
    const intake = await payload.create({ collection: "intake-items", draft: true, data: { channel: "manual", duplicateStatus: "unique", status: "ready", tenant: tenant.id, title: "Variant source" }, ...asUser(editor) })
    await payload.create({ collection: "article-sources", data: { edition: edition.id, intakeItem: intake.id, role: "primary", tenant: tenant.id }, ...asUser(editor) })
  })

  afterAll(async () => {
    for (const collection of ["article-sources", "intake-items", "content-editions", "contents", "sites", "users", "tenants"] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await payload.destroy()
  })

  it("creates an independent target-site draft and preserves article sources", async () => {
    const variant = await createSiteVariant(payload, { editionId, siteId: siteB.id, user: editor })
    const stored = await payload.findByID({ collection: "content-editions", draft: true, depth: 0, id: variant.editionId, overrideAccess: true })
    expect(stored).toMatchObject({ site: siteB.id, tenant: tenant.id, title: "Source edition", workflowStatus: "draft" })
    const sources = await payload.find({ collection: "article-sources", depth: 0, limit: 10, overrideAccess: true, where: { edition: { equals: variant.editionId } } })
    expect(sources.docs).toHaveLength(1)
    expect(await failureCodeOf(() => createSiteVariant(payload, { editionId, siteId: siteB.id, user: editor }))).toBe("SITE_VARIANT_ALREADY_EXISTS")
  })
})

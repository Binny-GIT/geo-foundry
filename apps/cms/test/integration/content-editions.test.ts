import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Content, ContentEdition, Site, Tenant, User } from "../../src/payload-types"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const validBody = [
  { blockType: "heading" as const, level: "2" as const, text: "Technical overview" },
  { blockType: "paragraph" as const, text: "This edition explains the technical implementation." },
  {
    blockType: "list" as const,
    style: "ordered" as const,
    items: [{ text: "Architecture" }, { text: "Trade-offs" }],
  },
  {
    blockType: "embed" as const,
    provider: "example",
    url: "https://example.com/demo",
    title: "Demo",
  },
]

describe("content and edition versioning integration", () => {
  let payload: Payload
  let tenant: Tenant
  let siteA: Site
  let siteB: Site
  let siteC: Site
  let superAdmin: User
  let tenantAdmin: User
  let editor: User
  let foreignEditor: User
  let foreignTenant: Tenant
  let content: Content
  let technicalEdition: ContentEdition
  let operationsEdition: ContentEdition

  beforeAll(async () => {
    payload = await getPayload({ config })
    for (const collection of [
      "content-editions",
      "contents",
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
      data: { name: "content-tenant" },
      ...asUser(superAdmin),
    })
    foreignTenant = await payload.create({
      collection: "tenants",
      data: { name: "foreign-tenant" },
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
    foreignEditor = (await payload.create({
      collection: "users",
      data: {
        email: "foreign-editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: foreignTenant.id,
      },
      ...asUser(superAdmin),
    })) as User

    siteA = await payload.create({
      collection: "sites",
      data: {
        name: "Site A",
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
        name: "Site B",
        tenant: tenant.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAdmin),
    })
    siteC = await payload.create({
      collection: "sites",
      data: {
        name: "Site C",
        tenant: tenant.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAdmin),
    })

    content = await payload.create({
      collection: "contents",
      data: {
        topic: "AI Customer Service",
        intent: "Explain how AI support changes operations",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })

    technicalEdition = (await payload.create({
      collection: "content-editions",
      data: {
        content: content.id,
        site: siteA.id,
        tenant: tenant.id,
        angle: "technical-implementation",
        title: "How AI customer service is built",
        summary: "Technical architecture of AI support.",
        body: validBody,
        primaryTopic: "AI support",
        creationOrigin: "human",
        workflowStatus: "draft",
      },
      ...asUser(editor),
    })) as ContentEdition

    operationsEdition = (await payload.create({
      collection: "content-editions",
      data: {
        content: content.id,
        site: siteB.id,
        tenant: tenant.id,
        angle: "business-operations",
        title: "What AI customer service means for operations",
        summary: "Operational impact of AI support.",
        body: validBody,
        primaryTopic: "AI support",
        creationOrigin: "human",
        workflowStatus: "draft",
      },
      ...asUser(editor),
    })) as ContentEdition
  })

  afterAll(async () => {
    for (const collection of [
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await payload.destroy()
  })

  it("Given one Content, when two editions target different sites, both coexist with distinct angles", () => {
    expect(technicalEdition.angle).toBe("technical-implementation")
    expect(operationsEdition.angle).toBe("business-operations")
    expect(String(technicalEdition.content)).toBe(String(operationsEdition.content))
    expect(String(technicalEdition.site)).not.toBe(String(operationsEdition.site))
  })

  it("Given a second edition for the same site lineage, when created, then it is rejected with a duplicate error", async () => {
    await expect(
      payload.create({
        collection: "content-editions",
        data: {
          content: content.id,
          site: siteA.id,
          tenant: tenant.id,
          angle: "duplicate-angle",
          title: "Duplicate lineage",
          summary: "Should not be allowed.",
          body: validBody,
          primaryTopic: "AI support",
          creationOrigin: "human",
          workflowStatus: "draft",
        },
        ...asUser(editor),
      }),
    ).rejects.toThrow(/CMS_EDITION_SITE_DUPLICATE/)
  })

  it("Given a foreign-tenant editor, when an edition references another tenant's content, then it is rejected", async () => {
    await expect(
      payload.create({
        collection: "content-editions",
        data: {
          content: content.id,
          site: siteA.id,
          tenant: foreignTenant.id,
          angle: "foreign-angle",
          title: "Foreign lineage",
          summary: "Should not be allowed.",
          body: validBody,
          primaryTopic: "AI support",
          creationOrigin: "human",
          workflowStatus: "draft",
        },
        ...asUser(foreignEditor),
      }),
    ).rejects.toThrow()
  })

  it("Given a body failing the PageDocument contract, when created, then validation rejects it", async () => {
    const invalidBody = [
      {
        blockType: "embed" as const,
        provider: "example",
        url: "not-a-url",
        title: "Broken embed",
      },
    ]
    await expect(
      payload.create({
        collection: "content-editions",
        data: {
          content: content.id,
          site: siteC.id,
          tenant: tenant.id,
          angle: "invalid-body",
          title: "Invalid body",
          summary: "Should not be allowed.",
          body: invalidBody,
          primaryTopic: "AI support",
          creationOrigin: "human",
          workflowStatus: "draft",
        },
        ...asUser(editor),
      }),
    ).rejects.toThrow(/field is invalid: Body/)
  })

  it("Given a published edition, when edited as a draft, then the published record stays unchanged and a new draft version exists", async () => {
    const published = await payload.update({
      collection: "content-editions",
      id: technicalEdition.id,
      data: { workflowStatus: "review" },
      ...asUser(editor),
    })
    expect(published.title).toBe("How AI customer service is built")

    await payload.update({
      collection: "content-editions",
      id: technicalEdition.id,
      draft: true,
      data: { title: "How AI customer service is built (2nd draft)" },
      ...asUser(editor),
    })

    const current = await payload.findByID({
      collection: "content-editions",
      id: technicalEdition.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(current.title).toBe("How AI customer service is built")

    const versions = await payload.findVersions({
      collection: "content-editions",
      where: { parent: { equals: technicalEdition.id } },
      limit: 10,
    })
    expect(versions.docs.length).toBeGreaterThanOrEqual(2)
    const draftVersion = versions.docs.find((doc) => doc.version?.title?.includes("2nd draft"))
    expect(draftVersion).toBeDefined()
  })

  it("Given anonymous sessions, when editions are read, then access is denied and no drafts leak", async () => {
    await expect(
      payload.find({ collection: "content-editions", overrideAccess: false }),
    ).rejects.toThrow()
    await expect(payload.find({ collection: "contents", overrideAccess: false })).rejects.toThrow()
  })

  it("Given tenant-scoped reads, when the foreign editor lists editions, then other tenants' editions are invisible", async () => {
    const visible = await payload.find({
      collection: "content-editions",
      ...asUser(foreignEditor),
    })
    expect(visible.docs).toHaveLength(0)
    const ownVisible = await payload.find({
      collection: "content-editions",
      ...asUser(editor),
    })
    expect(ownVisible.docs.length).toBeGreaterThanOrEqual(2)
  })

  it("Given a reviewer, when editions are updated, then the policy denies the write", async () => {
    const reviewer = (await payload.create({
      collection: "users",
      data: {
        email: "reviewer@geo-foundry.test",
        password: "reviewer-password",
        role: "reviewer",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    await expect(
      payload.update({
        collection: "content-editions",
        id: operationsEdition.id,
        data: { title: "Hijacked title" },
        ...asUser(reviewer),
      }),
    ).rejects.toThrow()
    await payload.delete({ collection: "users", id: reviewer.id, overrideAccess: true })
  })
})

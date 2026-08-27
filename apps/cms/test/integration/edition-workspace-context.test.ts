import { sql } from "@payloadcms/db-postgres"
import { getPayload, type Payload, type PayloadRequest } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import { editionWorkspaceContextEndpoint } from "../../src/endpoints/edition-workspace-context"
import { createReviewComment } from "../../src/services/review-comments"
import type { Site, Tenant, User } from "../../src/payload-types"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

type ContextResponse = {
  readonly assignees: readonly { readonly email: string | null; readonly id: number | null }[]
  readonly comments: readonly { readonly body: string | null; readonly id: number | null }[]
  readonly edition: Readonly<{ siteTimezone: string | null; workflowRevision: number }>
  readonly quality: Readonly<{ state: string | null } | null>
  readonly sources: readonly { readonly id: number | null; readonly role: string | null }[]
  readonly variants: readonly {
    readonly id: number | null
    readonly site: Readonly<{ id: number | null; name: string | null }>
    readonly title: string | null
  }[]
}

const callContext = async (
  payload: Payload,
  editionId: number,
  user: unknown,
): Promise<{ readonly body: ContextResponse | { readonly error: Readonly<{ code: string }> }; readonly status: number }> => {
  const req = {
    payload,
    routeParams: { id: String(editionId) },
    user,
  } as unknown as PayloadRequest
  const response = await editionWorkspaceContextEndpoint.handler(req)
  return { body: JSON.parse(await response.text()) as never, status: response.status }
}

describe("edition workspace context", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let publisher: User
  let foreignEditor: User
  let siteA: Site
  let siteB: Site
  let editionId: number
  let variantId: number

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "article-sources",
      "review-comments",
      "quality-assessments",
      "intake-items",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    const bootstrap = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-boot@geo-foundry.test", password: "bootstrap-password", role: "editor" },
    })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "workspace-context-tenant" }, ...asUser(bootstrap) })
    foreignTenant = await payload.create({ collection: "tenants", data: { name: "workspace-context-foreign" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-admin@geo-foundry.test", password: "tenant-admin-password", role: "tenant-admin", tenant: tenant.id },
      ...asUser(bootstrap),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-reviewer@geo-foundry.test", password: "reviewer-password", role: "reviewer", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-publisher@geo-foundry.test", password: "publisher-password", role: "publisher", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    foreignEditor = (await payload.create({
      collection: "users",
      data: { email: "workspace-context-foreign-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: foreignTenant.id },
      ...asUser(bootstrap),
    })) as User
    siteA = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "Context Site A", status: "active", tenant: tenant.id, timezone: "UTC" },
      ...asUser(tenantAdmin),
    })
    siteB = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "Context Site B", status: "active", tenant: tenant.id, timezone: "America/New_York" },
      ...asUser(tenantAdmin),
    })
    const content = await payload.create({
      collection: "contents",
      data: { createdBy: "human", intent: "workspace context coverage", tenant: tenant.id, topic: "workspace-context-topic" },
      ...asUser(editor),
    })
    const edition = (await payload.create({
      collection: "content-editions",
      draft: true,
      data: {
        angle: "context angle",
        body: [{ blockType: "paragraph", text: "Context body." }],
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "context",
        site: siteA.id,
        summary: "Context summary.",
        tenant: tenant.id,
        title: "Context edition",
      },
      ...asUser(editor),
    })) as { id: number }
    editionId = edition.id
    const variant = (await payload.create({
      collection: "content-editions",
      draft: true,
      data: {
        angle: "context angle",
        body: [{ blockType: "paragraph", text: "Context variant body." }],
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "context",
        site: siteB.id,
        summary: "Context variant summary.",
        tenant: tenant.id,
        title: "Context edition (Site B)",
      },
      ...asUser(editor),
    })) as { id: number }
    variantId = variant.id
    const intake = await payload.create({
      collection: "intake-items",
      draft: true,
      data: { channel: "manual", duplicateStatus: "unique", status: "ready", tenant: tenant.id, title: "Context source" },
      ...asUser(editor),
    })
    await payload.create({
      collection: "article-sources",
      data: { edition: editionId, intakeItem: intake.id, role: "primary", tenant: tenant.id },
      ...asUser(editor),
    })
    await createReviewComment(payload, { body: "Please tighten the intro.", editionId, user: editor })
  })

  afterAll(async () => {
    await payload.db.drizzle.execute(sql`
      TRUNCATE TABLE
        "geo_foundry"."outbox_events",
        "geo_foundry"."quality_assessments",
        "geo_foundry"."article_sources",
        "geo_foundry"."review_comments",
        "geo_foundry"."intake_items",
        "geo_foundry"."content_editions",
        "geo_foundry"."contents",
        "geo_foundry"."domains",
        "geo_foundry"."sites",
        "geo_foundry"."users",
        "geo_foundry"."tenants"
      RESTART IDENTITY CASCADE
    `)
    await payload.destroy()
  })

  it("returns sources, comments, assignees, and same-tenant variants for an editor", async () => {
    const { body, status } = await callContext(payload, editionId, editor)
    expect(status).toBe(200)
    const context = body as ContextResponse
    expect(context.sources).toHaveLength(1)
    expect(context.sources[0]?.role).toBe("primary")
    expect(context.comments).toHaveLength(1)
    expect(context.comments[0]?.body).toContain("tighten")
    expect(context.assignees.length).toBeGreaterThan(0)
    expect(context.assignees.some((assignee) => assignee.email === "workspace-context-editor@geo-foundry.test")).toBe(true)
    expect(context.variants).toHaveLength(1)
    expect(context.variants[0]?.id).toBe(variantId)
    expect(context.variants[0]?.site.name).toBe("Context Site B")
    expect(context.variants[0]?.title).toBe("Context edition (Site B)")
    expect(context.edition.siteTimezone).toBe("UTC")
  })

  it("hides the assignee list from reviewer and publisher while keeping workflow context", async () => {
    for (const actor of [reviewer, publisher]) {
      const { body, status } = await callContext(payload, editionId, actor)
      expect(status).toBe(200)
      const context = body as ContextResponse
      expect(context.assignees).toEqual([])
      expect(context.sources).toHaveLength(1)
      expect(context.comments).toHaveLength(1)
    }
  })

  it("normalizes cross-tenant access to a 404 without leaking tenant data", async () => {
    const { body, status } = await callContext(payload, editionId, foreignEditor)
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("EDITION_WORKSPACE_NOT_FOUND")
  })

  it("rejects unauthenticated and invalid requests", async () => {
    const anonymous = await callContext(payload, editionId, null)
    expect(anonymous.status).toBe(401)
    const invalid = await callContext(payload, Number.NaN, editor)
    expect(invalid.status).toBe(400)
  })
})

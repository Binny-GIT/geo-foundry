import { sql } from "@payloadcms/db-postgres"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import {
  acceptPerformanceSuggestionEndpoint,
  importPerformanceSnapshotsEndpoint,
} from "../../src/endpoints/performance-snapshots"
import { importPerformanceSnapshots, performanceSuggestions } from "../../src/services/performance-snapshots"
import { currentEditionInputHash, loadWorkflowEdition, recordAssessment, transitionEdition } from "../../src/services/edition-workflow"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run() } catch (error) { return (error as { code?: string }).code ?? String(error) }
  throw new Error("expected failure")
}

describe("performance snapshots", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let tenantAdmin: User
  let foreignAdmin: User
  let site: Site
  let editor: User
  let reviewer: User
  let publisher: User
  let publishedEditionId: number

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of ["performance-snapshots", "content-editions", "contents", "sites", "users", "tenants"] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    const bootstrap = (await payload.create({ collection: "users", data: { email: "performance-bootstrap@geo-foundry.test", password: "bootstrap-password", role: "editor" } })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "performance-tenant" }, ...asUser(bootstrap) })
    foreignTenant = await payload.create({ collection: "tenants", data: { name: "performance-foreign" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({ collection: "users", data: { email: "performance-admin@geo-foundry.test", password: "tenant-admin-password", role: "tenant-admin", tenant: tenant.id }, ...asUser(bootstrap) })) as User
    editor = (await payload.create({ collection: "users", data: { email: "performance-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id }, ...asUser(tenantAdmin) })) as User
    reviewer = (await payload.create({ collection: "users", data: { email: "performance-reviewer@geo-foundry.test", password: "reviewer-password", role: "reviewer", tenant: tenant.id }, ...asUser(tenantAdmin) })) as User
    publisher = (await payload.create({ collection: "users", data: { email: "performance-publisher@geo-foundry.test", password: "publisher-password", role: "publisher", tenant: tenant.id }, ...asUser(tenantAdmin) })) as User
    foreignAdmin = (await payload.create({ collection: "users", data: { email: "performance-foreign-admin@geo-foundry.test", password: "tenant-admin-password", role: "tenant-admin", tenant: foreignTenant.id }, ...asUser(bootstrap) })) as User
    site = await payload.create({ collection: "sites", data: { locale: "en-US", name: "Performance Site", status: "active", tenant: tenant.id, timezone: "UTC" }, ...asUser(tenantAdmin) })
    const content = await payload.create({ collection: "contents", data: { createdBy: "human", intent: "performance coverage", tenant: tenant.id, topic: "Performance topic" }, ...asUser(editor) })
    const edition = await payload.create({ collection: "content-editions", draft: true, data: { angle: "Performance angle", body: [{ blockType: "paragraph", text: "Published performance content." }], content: content.id, creationOrigin: "human", primaryTopic: "Performance topic", site: site.id, summary: "Performance summary.", tenant: tenant.id, title: "Performance edition" }, ...asUser(editor) })
    const intake = await payload.create({ collection: "intake-items", draft: true, data: { channel: "manual", duplicateStatus: "unique", status: "ready", tenant: tenant.id, title: "Performance source" }, ...asUser(editor) })
    await payload.create({ collection: "article-sources", data: { edition: edition.id, intakeItem: intake.id, role: "primary", tenant: tenant.id }, ...asUser(editor) })
    await transitionEdition(payload, { editionId: edition.id, target: "generating", user: editor })
    await transitionEdition(payload, { editionId: edition.id, target: "review", user: editor })
    const draft = await loadWorkflowEdition(payload, edition.id, {}, true)
    await recordAssessment(payload, { editionId: edition.id, inputHash: currentEditionInputHash(draft), issues: [], modelId: "performance-quality", promptVersion: "2026-08-27", provider: "deterministic", state: "passed", thresholdsHash: "a".repeat(64) })
    await transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer })
    await transitionEdition(payload, { editionId: edition.id, target: "compiled", compiledReleaseId: "performance-release", user: publisher })
    await transitionEdition(payload, { editionId: edition.id, target: "published", user: publisher })
    publishedEditionId = edition.id
  })

  afterAll(async () => {
    await payload.db.drizzle.execute(sql`
      TRUNCATE TABLE
        "geo_foundry"."outbox_events",
        "geo_foundry"."quality_assessments",
        "geo_foundry"."performance_snapshots",
        "geo_foundry"."article_sources",
        "geo_foundry"."intake_items",
        "geo_foundry"."url_records",
        "geo_foundry"."content_editions",
        "geo_foundry"."contents",
        "geo_foundry"."sites",
        "geo_foundry"."users",
        "geo_foundry"."tenants"
      RESTART IDENTITY CASCADE
    `)
    await payload.destroy()
  })

  it("imports idempotently and derives a deterministic traffic decline suggestion", async () => {
    const rows = [
      { editionId: publishedEditionId, observedAt: "2026-08-01T00:00:00.000Z", source: "csv", url: "https://performance.test/article", visits: 100 },
      { editionId: publishedEditionId, observedAt: "2026-08-15T00:00:00.000Z", source: "csv", url: "https://performance.test/article", visits: 60 },
    ]
    const first = await importPerformanceSnapshots(payload, { rows, siteId: site.id, user: tenantAdmin })
    expect(first).toEqual({ created: 2, replayed: 0 })
    const replay = await importPerformanceSnapshots(payload, { rows, siteId: site.id, user: tenantAdmin })
    expect(replay).toEqual({ created: 0, replayed: 2 })

    const suggestions = await performanceSuggestions(payload, tenantAdmin)
    expect(suggestions).toEqual([
      { editionId: publishedEditionId, reason: "traffic-decline", visits: { current: 60, previous: 100 } },
    ])
  })

  it("accepts a bounded CSV import with escaped fields and preserves idempotency", async () => {
    const csv = [
      "siteId,editionId,observedAt,source,url,visits,engagement,conversions",
      `${site.id},,2026-08-20T00:00:00.000Z,"Search, Console",https://performance.test/csv,12,0.5,1`,
    ].join("\r\n")
    const request = new Request("http://cms.test/api/performance-snapshots/import", {
      body: csv,
      headers: { "content-type": "text/csv; charset=utf-8" },
      method: "POST",
    })
    const first = await importPerformanceSnapshotsEndpoint.handler({
      headers: request.headers,
      json: request.json.bind(request),
      payload,
      text: request.text.bind(request),
      user: tenantAdmin,
    } as never)
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ created: 1, replayed: 0 })

    const replayRequest = new Request("http://cms.test/api/performance-snapshots/import", {
      body: csv,
      headers: { "content-type": "text/csv" },
      method: "POST",
    })
    const replay = await importPerformanceSnapshotsEndpoint.handler({
      headers: replayRequest.headers,
      json: replayRequest.json.bind(replayRequest),
      payload,
      text: replayRequest.text.bind(replayRequest),
      user: tenantAdmin,
    } as never)
    expect(replay.status).toBe(201)
    expect(await replay.json()).toEqual({ created: 0, replayed: 1 })
  })

  it("accepting a performance suggestion creates only a superseding draft", async () => {
    const request = new Request("http://cms.test/api/performance-snapshots/suggestions/accept", {
      body: JSON.stringify({ editionId: publishedEditionId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const response = await acceptPerformanceSuggestionEndpoint.handler({
      json: request.json.bind(request),
      payload,
      user: editor,
    } as never)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ createdDraft: true, editionId: publishedEditionId })

    const live = await payload.findByID({
      collection: "content-editions",
      depth: 0,
      id: publishedEditionId,
      overrideAccess: true,
    })
    expect(live).toMatchObject({ compiledRelease: "performance-release", workflowStatus: "published" })
    const draft = await payload.findByID({
      collection: "content-editions",
      depth: 0,
      draft: true,
      id: publishedEditionId,
      overrideAccess: true,
    })
    expect(draft).toMatchObject({ compiledRelease: null, workflowStatus: "draft", workflowRevision: 0 })
  })

  it("rejects a performance import for a site outside the tenant", async () => {
    expect(
      await failureCodeOf(() =>
        importPerformanceSnapshots(payload, {
          rows: [{ observedAt: "2026-08-15T00:00:00.000Z", source: "csv", url: "https://performance.test/article", visits: 1 }],
          siteId: site.id,
          user: foreignAdmin,
        }),
      ),
    ).toBe("PERFORMANCE_SNAPSHOT_SITE_NOT_FOUND")
  })
})

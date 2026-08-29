import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../src/payload-types"
import { recordAssessment, currentEditionInputHash, loadWorkflowEdition, transitionEdition } from "../../src/services/edition-workflow"
import { completeOperationStage, startOperationStage } from "../../src/services/operations-ledger"
import {
  cancelPublicationPlan,
  createPublicationPlan,
  dispatchDuePublicationPlans,
} from "../../src/services/publication-plans"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  throw new Error("expected failure")
}

describe("publication plans", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let publisher: User
  let foreignPublisher: User
  let serviceUser: User
  let site: Site
  let sequence = 0

  const makeApprovedEdition = async (): Promise<ContentEdition> => {
    sequence += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        createdBy: "human",
        intent: "Publication plan integration coverage",
        tenant: tenant.id,
        topic: `publication-plan-${sequence}`,
      },
      ...asUser(editor),
    })
    const edition = (await payload.create({
      collection: "content-editions",
      draft: true,
      data: {
        angle: `publication-plan-angle-${sequence}`,
        body: [{ blockType: "paragraph", text: "Ready for a scheduled publication." }],
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "publication-plan",
        site: site.id,
        summary: "Scheduled publication summary.",
        tenant: tenant.id,
        title: `Publication plan ${sequence}`,
      },
      ...asUser(editor),
    })) as ContentEdition
    const intake = await payload.create({
      collection: "intake-items",
      draft: true,
      data: {
        channel: "manual",
        duplicateStatus: "unique",
        status: "ready",
        tenant: tenant.id,
        title: `Publication plan source ${sequence}`,
      },
      ...asUser(editor),
    })
    await payload.create({
      collection: "article-sources",
      data: { edition: edition.id, intakeItem: intake.id, role: "primary", tenant: tenant.id },
      ...asUser(editor),
    })
    await transitionEdition(payload, { editionId: edition.id, target: "generating", user: editor })
    await transitionEdition(payload, { editionId: edition.id, target: "review", user: editor })
    const draft = await loadWorkflowEdition(payload, edition.id, {}, true)
    await recordAssessment(payload, {
      editionId: edition.id,
      inputHash: currentEditionInputHash(draft),
      issues: [],
      modelId: "publication-plan-quality-v1",
      promptVersion: "2026-08-27",
      provider: "deterministic-test-provider",
      state: "passed",
      thresholdsHash: "a".repeat(64),
    })
    await transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer })
    return edition
  }

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "publication-plans",
      "idempotency-records",
      "operations",
      "outbox-events",
      "quality-assessments",
      "review-comments",
      "article-sources",
      "source-snapshots",
      "intake-items",
      "connectors",
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
      data: { email: "publication-plan-bootstrap@geo-foundry.test", password: "bootstrap-password", role: "editor" },
    })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "publication-plan-tenant" }, ...asUser(bootstrap) })
    foreignTenant = await payload.create({ collection: "tenants", data: { name: "publication-plan-foreign" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-admin@geo-foundry.test", password: "tenant-admin-password", role: "tenant-admin", tenant: tenant.id },
      ...asUser(bootstrap),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-reviewer@geo-foundry.test", password: "reviewer-password", role: "reviewer", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-publisher@geo-foundry.test", password: "publisher-password", role: "publisher", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    foreignPublisher = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-foreign-publisher@geo-foundry.test", password: "publisher-password", role: "publisher", tenant: foreignTenant.id },
      ...asUser(bootstrap),
    })) as User
    serviceUser = (await payload.create({
      collection: "users",
      data: { email: "publication-plan-service@geo-foundry.test", password: "service-password", role: "content-service", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "Publication Plan Site", status: "active", tenant: tenant.id, timezone: "America/New_York" },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "publication-plans",
      "idempotency-records",
      "operations",
      "outbox-events",
      "quality-assessments",
      "review-comments",
      "article-sources",
      "source-snapshots",
      "intake-items",
      "connectors",
      "url-records",
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

  it("requires a publisher and an explicit UTC instant with canonical timezone", async () => {
    const edition = await makeApprovedEdition()
    expect(
      await failureCodeOf(() =>
        createPublicationPlan(payload, {
          editionId: edition.id,
          scheduledFor: "2026-11-01T01:30:00",
          timezone: "America/New_York",
          user: publisher,
        }),
      ),
    ).toBe("PUBLICATION_PLAN_INSTANT_INVALID")
    expect(
      await failureCodeOf(() =>
        createPublicationPlan(payload, {
          editionId: edition.id,
          scheduledFor: "2026-11-01T05:30:00.000Z",
          timezone: "US/Eastern",
          user: publisher,
        }),
      ),
    ).toBe("PUBLICATION_PLAN_TIMEZONE_INVALID")
    expect(
      await failureCodeOf(() =>
        createPublicationPlan(payload, {
          editionId: edition.id,
          scheduledFor: "2026-11-01T05:30:00.000Z",
          timezone: "America/New_York",
          user: reviewer,
        }),
      ),
    ).toBe("EDITION_WORKFLOW_PUBLISHER_REQUIRED")
  })

  it("cancels only a pending plan in the requesting tenant", async () => {
    const edition = await makeApprovedEdition()
    const plan = await createPublicationPlan(payload, {
      editionId: edition.id,
      scheduledFor: "2026-12-01T15:00:00.000Z",
      timezone: "America/New_York",
      user: publisher,
    })
    expect(await failureCodeOf(() => cancelPublicationPlan(payload, { planId: plan.planId, user: foreignPublisher }))).toBe(
      "PUBLICATION_PLAN_NOT_FOUND",
    )
    await cancelPublicationPlan(payload, { planId: plan.planId, user: publisher })
    const stored = await payload.find({ collection: "publication-plans", depth: 0, limit: 1, overrideAccess: true, where: { planId: { equals: plan.planId } } })
    expect(stored.docs[0]).toMatchObject({ status: "cancelled" })
  })

  it("claims a due plan once and creates one publisher-authorized publish operation", async () => {
    const edition = await makeApprovedEdition()
    const plan = await createPublicationPlan(payload, {
      editionId: edition.id,
      scheduledFor: "2026-08-27T00:00:00.000Z",
      timezone: "America/New_York",
      user: publisher,
    })
    const [first, second] = await Promise.all([
      dispatchDuePublicationPlans(payload, { now: "2026-08-27T12:00:00.000Z", user: serviceUser, workerId: "worker-a" }),
      dispatchDuePublicationPlans(payload, { now: "2026-08-27T12:00:00.000Z", user: serviceUser, workerId: "worker-b" }),
    ])
    const dispatched = [...first, ...second]
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.planId).toBe(plan.planId)
    const stored = await payload.find({ collection: "publication-plans", depth: 0, limit: 1, overrideAccess: true, where: { planId: { equals: plan.planId } } })
    expect(stored.docs[0]).toMatchObject({ status: "running", operationId: dispatched[0]?.operationId })
    const operation = await payload.find({ collection: "operations", depth: 0, limit: 10, overrideAccess: true, where: { operationId: { equals: dispatched[0]?.operationId } } })
    expect(operation.docs).toHaveLength(1)
    expect(operation.docs[0]?.operationType).toBe("publish")
  })

  it("settles a running plan after its queued publish operation reaches a terminal state", async () => {
    const edition = await makeApprovedEdition()
    const plan = await createPublicationPlan(payload, {
      editionId: edition.id,
      scheduledFor: "2026-08-27T00:00:00.000Z",
      timezone: "America/New_York",
      user: publisher,
    })
    const [dispatched] = await dispatchDuePublicationPlans(payload, {
      now: "2026-08-27T12:00:00.000Z",
      user: serviceUser,
      workerId: "worker-settlement",
    })
    expect(dispatched).toMatchObject({ planId: plan.planId })
    await startOperationStage(payload, {
      attempt: 1,
      operationId: dispatched?.operationId ?? "",
      stage: "publish-gate",
      user: serviceUser,
    })
    await completeOperationStage(payload, {
      attempt: 1,
      operationId: dispatched?.operationId ?? "",
      outcome: "succeeded",
      result: { releaseId: "release-from-publish-worker" },
      stage: "publish-gate",
      user: serviceUser,
    })

    expect(
      await dispatchDuePublicationPlans(payload, {
        now: "2026-08-27T12:01:00.000Z",
        user: serviceUser,
        workerId: "worker-settlement",
      }),
    ).toEqual([])
    const stored = await payload.find({
      collection: "publication-plans",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { planId: { equals: plan.planId } },
    })
    expect(stored.docs[0]).toMatchObject({
      operationId: dispatched?.operationId,
      publishedAt: "2026-08-27T12:01:00.000Z",
      releaseId: "release-from-publish-worker",
      status: "succeeded",
    })
  })
})

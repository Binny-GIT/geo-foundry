import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../src/payload-types"
import {
  OperationsLedgerError,
  submitEditionEvaluationOperation,
} from "../../src/services/operations-ledger"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })

const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  throw new Error("expected failure")
}

describe("editor evaluation intent", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let foreignEditor: User
  let site: Site
  let sequence = 0

  const createEdition = async (): Promise<ContentEdition> => {
    sequence += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        createdBy: "human",
        intent: "Editor evaluation integration fixture",
        tenant: tenant.id,
        topic: `editor-evaluation-${sequence}`,
      },
      ...asUser(editor),
    })
    return (await payload.create({
      collection: "content-editions",
      data: {
        angle: "editor evaluation",
        body: [{ blockType: "paragraph", text: "Evaluate this draft." }],
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "editor-evaluation",
        site: site.id,
        summary: "Evaluation intent fixture.",
        tenant: tenant.id,
        title: `Editor evaluation ${sequence}`,
      },
      draft: true,
      ...asUser(editor),
    })) as ContentEdition
  }

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "idempotency-records",
      "operations",
      "outbox-events",
      "quality-assessments",
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
    const bootstrap = (await payload.create({
      collection: "users",
      data: { email: "editor-evaluation-boot@geo-foundry.test", password: "bootstrap-password", role: "editor" },
    })) as User
    tenant = await payload.create({ collection: "tenants", data: { name: "editor-evaluation-tenant" }, ...asUser(bootstrap) })
    foreignTenant = await payload.create({ collection: "tenants", data: { name: "editor-evaluation-foreign" }, ...asUser(bootstrap) })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: { email: "editor-evaluation-admin@geo-foundry.test", password: "admin-password", role: "tenant-admin", tenant: tenant.id },
      ...asUser(bootstrap),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: { email: "editor-evaluation-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: { email: "editor-evaluation-reviewer@geo-foundry.test", password: "reviewer-password", role: "reviewer", tenant: tenant.id },
      ...asUser(tenantAdmin),
    })) as User
    foreignEditor = (await payload.create({
      collection: "users",
      data: { email: "editor-evaluation-foreign-editor@geo-foundry.test", password: "editor-password", role: "editor", tenant: foreignTenant.id },
      ...asUser(bootstrap),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: { locale: "en-US", name: "Editor evaluation site", status: "active", tenant: tenant.id, timezone: "UTC" },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "idempotency-records",
      "operations",
      "outbox-events",
      "quality-assessments",
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

  it("creates an editor-audited queued evaluation operation and transactional outbox event", async () => {
    const edition = await createEdition()
    const outcome = await submitEditionEvaluationOperation(payload, {
      editionId: edition.id,
      idempotencyKey: "editor-evaluation-0001",
      requestId: "editor-evaluation-request-0001",
      thresholds: { dimensionMin: 75, overallMin: 80 },
      user: editor,
    })

    expect(outcome).toMatchObject({
      created: true,
      operation: {
        operationType: "evaluate",
        requestPayload: { body: { editionId: edition.id, thresholds: { dimensionMin: 75, overallMin: 80 } } },
        state: "queued",
        tenantId: tenant.id,
      },
    })
    const assessments = await payload.count({ collection: "quality-assessments", overrideAccess: true })
    expect(assessments.totalDocs).toBe(0)
    const events = await payload.find({
      collection: "outbox-events",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { operationId: { equals: outcome.operation.operationId } },
    })
    expect(events.docs).toHaveLength(1)
    expect(events.docs[0]).toMatchObject({
      aggregateId: edition.id,
      eventPayload: { operationType: "evaluate", thresholds: { dimensionMin: 75, overallMin: 80 } },
      requestId: "editor-evaluation-request-0001",
      status: "pending",
      type: "evaluation.requested",
    })
  })

  it("replays an exact editor request and rejects body reuse", async () => {
    const edition = await createEdition()
    const first = await submitEditionEvaluationOperation(payload, {
      editionId: edition.id,
      idempotencyKey: "editor-evaluation-0002",
      requestId: "editor-evaluation-request-0002",
      user: editor,
    })
    const replay = await submitEditionEvaluationOperation(payload, {
      editionId: edition.id,
      idempotencyKey: "editor-evaluation-0002",
      requestId: "editor-evaluation-request-0003",
      user: editor,
    })
    expect(replay).toMatchObject({ created: false, operation: { operationId: first.operation.operationId } })
    expect(
      await failureCodeOf(() =>
        submitEditionEvaluationOperation(payload, {
          editionId: edition.id,
          idempotencyKey: "editor-evaluation-0002",
          requestId: "editor-evaluation-request-0004",
          thresholds: { dimensionMin: 70, overallMin: 75 },
          user: editor,
        }),
      ),
    ).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  it("rejects non-editor and foreign tenant evaluation intent without changing the edition", async () => {
    const edition = await createEdition()
    expect(
      await failureCodeOf(() =>
        submitEditionEvaluationOperation(payload, {
          editionId: edition.id,
          idempotencyKey: "editor-evaluation-0003",
          requestId: "editor-evaluation-request-0005",
          user: reviewer,
        }),
      ),
    ).toBe("EDITION_WORKFLOW_EDITOR_REQUIRED")
    expect(
      await failureCodeOf(() =>
        submitEditionEvaluationOperation(payload, {
          editionId: edition.id,
          idempotencyKey: "editor-evaluation-0004",
          requestId: "editor-evaluation-request-0006",
          user: foreignEditor,
        }),
      ),
    ).toBe("EDITION_WORKFLOW_TENANT_MISMATCH")
    const stored = await payload.findByID({ collection: "content-editions", depth: 0, draft: true, id: edition.id, overrideAccess: true })
    expect(stored.workflowStatus).toBe("draft")
  })

  it("keeps the operation error type exported for endpoint mapping", () => {
    expect(new OperationsLedgerError("IDEMPOTENCY_KEY_REUSED").code).toBe("IDEMPOTENCY_KEY_REUSED")
  })
})

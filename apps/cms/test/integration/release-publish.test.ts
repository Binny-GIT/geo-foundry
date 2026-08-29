import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../src/payload-types"
import { recordCompileResult } from "../../src/services/edition-integration"
import {
  currentEditionInputHash,
  loadWorkflowEdition,
  recordAssessment,
  transitionEdition,
  type AuditEntry,
} from "../../src/services/edition-workflow"
import { recordPublishedRelease } from "../../src/services/release-registry"
import { submitEditionPublishOperation, submitOperation } from "../../src/services/operations-ledger"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const validBody = [
  { blockType: "heading" as const, level: "2" as const, text: "Release publish overview" },
  { blockType: "paragraph" as const, text: "Exercises the publisher-authorized publish path." },
]

const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  throw new Error("expected the call to fail, but it resolved")
}

describe("publisher-authorized release publication", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let site: Site
  let otherSite: Site
  let bootstrapUser: User
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let publisher: User
  let foreignPublisher: User
  let serviceUser: User
  let editionSeq = 0

  const makeEdition = async (targetSite: Site): Promise<ContentEdition> => {
    editionSeq += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: `Release publish topic ${editionSeq}`,
        intent: "Exercise the publisher-authorized publish path",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })
    const edition = (await payload.create({
      collection: "content-editions",
      draft: true,
      data: {
        angle: `release-publish-angle-${editionSeq}`,
        body: validBody,
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "release-publish",
        site: targetSite.id,
        summary: "Summary before publication.",
        tenant: tenant.id,
        title: `Release publish edition ${editionSeq}`,
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
        title: `Release publish source ${editionSeq}`,
      },
      ...asUser(editor),
    })
    await payload.create({
      collection: "article-sources",
      data: {
        edition: edition.id,
        intakeItem: intake.id,
        role: "primary",
        tenant: tenant.id,
      },
      ...asUser(editor),
    })
    return edition
  }

  const recordAssessmentFor = async (editionId: number): Promise<void> => {
    const doc = await loadWorkflowEdition(payload, editionId, {}, true)
    await recordAssessment(payload, {
      editionId,
      inputHash: currentEditionInputHash(doc),
      issues: [],
      modelId: "release-publish-quality-v1",
      promptVersion: "2026-08-23",
      provider: "deterministic-test-provider",
      state: "passed",
      thresholdsHash: "c".repeat(64),
    })
  }

  const advanceToCompiled = async (
    editionId: number,
    releaseId: string,
  ): Promise<{ manifestSha256: string }> => {
    await transitionEdition(payload, { editionId, target: "generating", user: editor })
    await transitionEdition(payload, { editionId, target: "review", user: editor })
    await recordAssessmentFor(editionId)
    await transitionEdition(payload, { editionId, target: "approved", user: reviewer })
    const manifestSha256 = "d".repeat(64)
    await recordCompileResult(payload, {
      editionId,
      manifestSha256,
      objectCount: 2,
      releaseId,
      totalBytes: 512,
      user: serviceUser,
    })
    return { manifestSha256 }
  }

  const receiptFor = (releaseId: string, manifestSha256: string, targetSite: Site) => ({
    action: "publish" as const,
    actor: { actorId: "geo-foundry-worker", kind: "service" as const },
    manifestSha256,
    newEtag: `"etag-${releaseId}"`,
    oldEtag: null,
    recordedAt: "2026-08-23T06:00:00.000Z",
    releaseId,
    schemaVersion: 1 as const,
    siteId: `site-${targetSite.id}`,
  })

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "releases",
      "outbox-events",
      "idempotency-records",
      "operations",
      "quality-assessments",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }

    bootstrapUser = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-boot@geo-foundry.test",
        password: "bootstrap-password-260823",
        role: "editor",
      },
    })) as User
    tenant = await payload.create({
      collection: "tenants",
      data: { name: "release-publish-tenant" },
      ...asUser(bootstrapUser),
    })
    foreignTenant = await payload.create({
      collection: "tenants",
      data: { name: "release-publish-foreign-tenant" },
      ...asUser(bootstrapUser),
    })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-reviewer@geo-foundry.test",
        password: "reviewer-password",
        role: "reviewer",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-publisher@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    serviceUser = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    foreignPublisher = (await payload.create({
      collection: "users",
      data: {
        email: "release-publish-foreign-publisher@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: foreignTenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: {
        locale: "en-US",
        name: "Release Publish Site",
        status: "active",
        tenant: tenant.id,
        timezone: "UTC",
      },
      ...asUser(tenantAdmin),
    })
    otherSite = await payload.create({
      collection: "sites",
      data: {
        locale: "en-US",
        name: "Release Publish Other Site",
        status: "active",
        tenant: tenant.id,
        timezone: "UTC",
      },
      ...asUser(tenantAdmin),
    })
    await payload.create({
      collection: "domains",
      data: {
        hostname: "release-publish.test",
        role: "canonical",
        site: site.id,
        status: "active",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "releases",
      "outbox-events",
      "idempotency-records",
      "operations",
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

  it("rejects a publish operation request from a non-publisher role", async () => {
    const edition = await makeEdition(site)
    await advanceToCompiled(edition.id, "release-publish-role-guard")

    const code = await failureCodeOf(() =>
      submitEditionPublishOperation(payload, { editionId: edition.id, user: reviewer }),
    )
    expect(code).toBe("EDITION_WORKFLOW_PUBLISHER_REQUIRED")
  })

  it("rejects a publish operation request from a publisher in a foreign tenant", async () => {
    const edition = await makeEdition(site)
    await advanceToCompiled(edition.id, "release-publish-tenant-guard")

    const code = await failureCodeOf(() =>
      submitEditionPublishOperation(payload, { editionId: edition.id, user: foreignPublisher }),
    )
    expect(code).toBe("EDITION_WORKFLOW_TENANT_MISMATCH")
  })

  it("creates one publish operation for an approved edition and assigns its deterministic release identity", async () => {
    const edition = await makeEdition(site)
    await transitionEdition(payload, { editionId: edition.id, target: "generating", user: editor })
    await transitionEdition(payload, { editionId: edition.id, target: "review", user: editor })
    await recordAssessmentFor(edition.id)
    await transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer })
    const reserved = await payload.find({
      collection: "url-records",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { content: { equals: edition.content } },
    })
    expect(reserved.docs).toHaveLength(1)
    expect(reserved.docs[0]).toMatchObject({ site: site.id, state: "reserved" })

    const submitted = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      user: publisher,
    })
    expect(submitted.created).toBe(true)
    expect(submitted.state).toBe("queued")
    expect(submitted.releaseId).toMatch(/^rel-[0-9a-f]{24}$/)
  })

  it("rejects a publish operation request for an edition that is not approved", async () => {
    const edition = await makeEdition(site)
    await transitionEdition(payload, { editionId: edition.id, target: "generating", user: editor })

    const code = await failureCodeOf(() =>
      submitEditionPublishOperation(payload, { editionId: edition.id, user: publisher }),
    )
    expect(code).toBe("EDITION_WORKFLOW_NOT_APPROVED")
  })

  it("creates one idempotent publish operation per compiled release and replays identical resubmits", async () => {
    const edition = await makeEdition(site)
    await advanceToCompiled(edition.id, "release-publish-idempotent")

    const first = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      reason: "Approved launch window",
      user: publisher,
    })
    expect(first.created).toBe(true)
    expect(first.releaseId).toBe("release-publish-idempotent")
    expect(first.state).toBe("queued")
    const operation = await payload.find({
      collection: "operations",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { operationId: { equals: first.operationId } },
    })
    expect((operation.docs[0]?.auditLog as AuditEntry[] | undefined)?.[0]).toMatchObject({
      action: "operation.created",
      reason: "Approved launch window",
    })

    const replay = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      user: publisher,
    })
    expect(replay.created).toBe(false)
    expect(replay.operationId).toBe(first.operationId)
    expect(replay.releaseId).toBe(first.releaseId)
  })

  it("advances a compiled edition to published under the operation's original publisher identity, then idempotently no-ops on receipt replay", async () => {
    const edition = await makeEdition(site)
    const { manifestSha256 } = await advanceToCompiled(edition.id, "release-publish-happy-path")

    const submitted = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      user: publisher,
    })
    const receipt = receiptFor("release-publish-happy-path", manifestSha256, site)

    await recordPublishedRelease(payload, {
      editionId: edition.id,
      operationId: submitted.operationId,
      receipt,
      siteId: site.id,
      user: serviceUser,
    })

    const live = await loadWorkflowEdition(payload, edition.id)
    expect(live.workflowStatus).toBe("published")
    expect(live.compiledRelease).toBe("release-publish-happy-path")
    const audit = Array.isArray(live.auditLog) ? (live.auditLog as AuditEntry[]) : []
    const publishedEntry = audit.at(-1)
    expect(publishedEntry?.action).toBe("content-edition.compiled.published")
    expect(publishedEntry?.actor.role).toBe("publisher")
    expect(publishedEntry?.actor.userId).toBe(String(publisher.id))
    expect(publishedEntry?.actor.kind).toBe("user")
    const activeUrls = await payload.find({
      collection: "url-records",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { content: { equals: edition.content } },
    })
    expect(activeUrls.docs).toHaveLength(1)
    expect(activeUrls.docs[0]).toMatchObject({ state: "active" })
    expect(activeUrls.docs[0]?.canonicalUrl).toMatch(
      /^https:\/\/release-publish\.test\/en-US\/articles\/release-publish-edition-\d+$/,
    )

    const revisionAfterFirst = Number(live.workflowRevision)

    await recordPublishedRelease(payload, {
      editionId: edition.id,
      operationId: submitted.operationId,
      receipt,
      siteId: site.id,
      user: serviceUser,
    })
    const afterReplay = await loadWorkflowEdition(payload, edition.id)
    expect(afterReplay.workflowStatus).toBe("published")
    expect(Number(afterReplay.workflowRevision)).toBe(revisionAfterFirst)
    const urlsAfterReplay = await payload.find({
      collection: "url-records",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { content: { equals: edition.content } },
    })
    expect(urlsAfterReplay.docs).toHaveLength(1)
    expect(urlsAfterReplay.docs[0]).toMatchObject({ state: "active" })
  })

  it("rejects a publish receipt whose release does not match the edition's compiled evidence", async () => {
    const edition = await makeEdition(site)
    const { manifestSha256 } = await advanceToCompiled(edition.id, "release-publish-mismatch-real")
    const submitted = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      user: publisher,
    })

    const code = await failureCodeOf(() =>
      recordPublishedRelease(payload, {
        editionId: edition.id,
        operationId: submitted.operationId,
        receipt: receiptFor("release-publish-mismatch-different", manifestSha256, site),
        siteId: site.id,
        user: serviceUser,
      }),
    )
    expect(code).toBe("RELEASE_EDITION_NOT_COMPILED")
    const live = await loadWorkflowEdition(payload, edition.id, {}, true)
    expect(live.workflowStatus).toBe("compiled")
  })

  it("rejects a publish receipt reported against a different site than the edition belongs to", async () => {
    const edition = await makeEdition(site)
    const { manifestSha256 } = await advanceToCompiled(edition.id, "release-publish-site-guard")
    const submitted = await submitEditionPublishOperation(payload, {
      editionId: edition.id,
      user: publisher,
    })

    const code = await failureCodeOf(() =>
      recordPublishedRelease(payload, {
        editionId: edition.id,
        operationId: submitted.operationId,
        receipt: receiptFor("release-publish-site-guard", manifestSha256, otherSite),
        siteId: otherSite.id,
        user: serviceUser,
      }),
    )
    expect(code).toBe("RELEASE_EDITION_SITE_MISMATCH")
    const live = await loadWorkflowEdition(payload, edition.id, {}, true)
    expect(live.workflowStatus).toBe("compiled")
  })

  it("rejects publication under an operation that was not created by the edition's publisher", async () => {
    const edition = await makeEdition(site)
    const { manifestSha256 } = await advanceToCompiled(
      edition.id,
      "release-publish-authorization-guard",
    )
    const impersonated = await submitOperation(payload, {
      endpoint: `/editions/${edition.id}/publish`,
      idempotencyKey: `release-publish-authorization-guard-${edition.id}`,
      operationType: "publish",
      requestPayload: { body: { editionId: edition.id } },
      user: serviceUser,
    })

    const code = await failureCodeOf(() =>
      recordPublishedRelease(payload, {
        editionId: edition.id,
        operationId: impersonated.operation.operationId,
        receipt: receiptFor("release-publish-authorization-guard", manifestSha256, site),
        siteId: site.id,
        user: serviceUser,
      }),
    )
    expect(code).toBe("RELEASE_PUBLISH_AUTHORIZATION_INVALID")
    const live = await loadWorkflowEdition(payload, edition.id, {}, true)
    expect(live.workflowStatus).toBe("compiled")
  })
})

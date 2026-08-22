import { DOMAIN_ERROR_CODE } from "@geo/domain"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../src/payload-types"
import {
  createDraftFromPublished,
  currentEditionInputHash,
  loadWorkflowEdition,
  recordAssessment,
  transitionEdition,
  type AuditEntry,
  type WorkflowEditionDoc,
} from "../../src/services/edition-workflow"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const validBody = [
  { blockType: "heading" as const, level: "2" as const, text: "Workflow overview" },
  { blockType: "paragraph" as const, text: "This edition exercises the publication gates." },
]

/**
 * Asserts the workflow call fails and yields its stable error code, so every
 * failure scenario asserts on a code rather than a message string.
 */
const failureCodeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  throw new Error("expected the workflow call to fail, but it resolved")
}

describe("edition workflow gating integration", () => {
  let payload: Payload
  let tenant: Tenant
  let site: Site
  let bootstrapUser: User
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let publisher: User
  let editionSeq = 0

  const makeEdition = async (): Promise<ContentEdition> => {
    editionSeq += 1
    const angle = `workflow-angle-${editionSeq}`
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: `Workflow topic ${editionSeq}`,
        intent: "Exercise the publication gates",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })
    return (await payload.create({
      collection: "content-editions",
      data: {
        content: content.id,
        site: site.id,
        tenant: tenant.id,
        angle,
        title: `Workflow edition ${editionSeq}`,
        summary: "Summary for the workflow edition.",
        body: validBody,
        primaryTopic: "workflow",
        creationOrigin: "human",
      },
      ...asUser(editor),
    })) as ContentEdition
  }

  const recordAssessmentFor = async (
    editionId: number,
    state: "error" | "failed" | "passed",
    issues: readonly { readonly code: string; readonly severity: string }[] = [],
  ): Promise<number> => {
    const doc = await loadWorkflowEdition(payload, editionId)
    return recordAssessment(payload, {
      editionId,
      inputHash: currentEditionInputHash(doc),
      issues,
      modelId: "quality-model-v1",
      promptVersion: "2026-08-18",
      provider: "deterministic-test-provider",
      state,
      thresholdsHash: "thresholds-sha256-fixture",
    })
  }

  const advanceToReview = async (editionId: number): Promise<void> => {
    await transitionEdition(payload, { editionId, target: "generating", user: editor })
    await transitionEdition(payload, { editionId, target: "review", user: editor })
  }

  const advanceToCompiled = async (editionId: number, releaseId: string): Promise<void> => {
    await advanceToReview(editionId)
    await recordAssessmentFor(editionId, "passed")
    await transitionEdition(payload, { editionId, target: "approved", user: reviewer })
    await transitionEdition(payload, {
      editionId,
      target: "compiled",
      user: publisher,
      compiledReleaseId: releaseId,
    })
  }

  const auditOf = async (editionId: number): Promise<readonly AuditEntry[]> => {
    const doc = await loadWorkflowEdition(payload, editionId)
    return Array.isArray(doc.auditLog) ? (doc.auditLog as AuditEntry[]) : []
  }

  const statusOf = async (editionId: number): Promise<unknown> => {
    const doc = await loadWorkflowEdition(payload, editionId)
    return doc.workflowStatus
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    for (const collection of [
      "outbox-events",
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
        email: "workflow-boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User

    tenant = await payload.create({
      collection: "tenants",
      data: { name: "workflow-tenant" },
      ...asUser(bootstrapUser),
    })

    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "workflow-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: {
        email: "workflow-editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: {
        email: "workflow-reviewer@geo-foundry.test",
        password: "reviewer-password",
        role: "reviewer",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: {
        email: "workflow-publisher@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User

    site = await payload.create({
      collection: "sites",
      data: {
        name: "Workflow Site",
        tenant: tenant.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAdmin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "outbox-events",
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
    await payload.destroy()
  })

  it("Given the editorial happy path, when each role acts in turn, then the edition reaches published with a complete audit trail", async () => {
    const edition = await makeEdition()

    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "generating",
        user: editor,
      }),
    ).toBe("generating")
    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "review",
        user: editor,
      }),
    ).toBe("review")

    await recordAssessmentFor(edition.id, "passed")

    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "approved",
        user: reviewer,
        reason: "meets the editorial bar",
      }),
    ).toBe("approved")
    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "compiled",
        user: publisher,
        compiledReleaseId: "release-2026-08-18-happy",
      }),
    ).toBe("compiled")
    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "published",
        user: publisher,
        reason: "scheduled launch",
      }),
    ).toBe("published")

    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(doc.workflowStatus).toBe("published")
    expect(Number(doc.workflowRevision)).toBe(5)
    expect(doc.compiledRelease).toBe("release-2026-08-18-happy")

    const audit = Array.isArray(doc.auditLog) ? (doc.auditLog as AuditEntry[]) : []
    expect(audit.map((entry) => entry.to)).toEqual([
      "generating",
      "review",
      "approved",
      "compiled",
      "published",
    ])

    const published = audit.at(-1)
    expect(published).toBeDefined()
    expect(published?.action).toBe("content-edition.compiled.published")
    expect(published?.from).toBe("compiled")
    expect(published?.actor.role).toBe("publisher")
    expect(published?.actor.userId).toBe(String(publisher.id))
    expect(published?.actor.kind).toBe("user")
    expect(Number(published?.tenantId)).toBe(Number(tenant.id))
    expect(published?.reason).toBe("scheduled launch")
    expect(Number.isFinite(Date.parse(String(published?.at)))).toBe(true)
  })

  it("Given a published edition, when a publisher archives it, then the live document is archived", async () => {
    const edition = await makeEdition()
    await advanceToCompiled(edition.id, "release-2026-08-18-archive")
    await transitionEdition(payload, {
      editionId: edition.id,
      target: "published",
      user: publisher,
    })

    expect(
      await transitionEdition(payload, {
        editionId: edition.id,
        target: "archived",
        user: publisher,
      }),
    ).toBe("archived")

    const live = await loadWorkflowEdition(payload, edition.id)
    expect(live.workflowStatus).toBe("archived")
    expect(Number(live.workflowRevision)).toBe(6)
    expect((await auditOf(edition.id)).at(-1)?.action).toBe("content-edition.published.archived")
  })

  it("Given no recorded assessment, when approval is attempted, then it fails closed", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer }),
    )
    expect(code).toBe("EDITION_WORKFLOW_ASSESSMENT_REQUIRED")
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given a failed assessment carrying a critical issue, when approval is attempted, then it fails closed", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)
    await recordAssessmentFor(edition.id, "failed", [
      { code: "UNSUPPORTED_CLAIM", severity: "critical" },
    ])

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer }),
    )
    expect(code).toBe("EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED")
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given a provider error assessment, when approval is attempted, then it fails closed", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)
    await recordAssessmentFor(edition.id, "error")

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer }),
    )
    expect(code).toBe("EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED")
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given a body edited after a passing assessment, when approval is attempted, then the stale evidence is rejected", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)
    await recordAssessmentFor(edition.id, "passed")

    await payload.update({
      collection: "content-editions",
      id: edition.id,
      data: { title: "Workflow edition retitled after assessment" },
      ...asUser(editor),
    })

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer }),
    )
    expect(code).toBe("EDITION_WORKFLOW_STALE_ASSESSMENT")
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given an editor acting as reviewer, when approval is attempted, then the role guard rejects it", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)
    await recordAssessmentFor(edition.id, "passed")

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "approved", user: editor }),
    )
    expect(code).toBe(DOMAIN_ERROR_CODE.CONTENT_EDITION_REVIEWER_REQUIRED)
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given a reviewer acting as publisher, when publication is attempted, then the role guard rejects it", async () => {
    const edition = await makeEdition()
    await advanceToCompiled(edition.id, "release-2026-08-18-role-guard")

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "published", user: reviewer }),
    )
    expect(code).toBe(DOMAIN_ERROR_CODE.CONTENT_EDITION_PUBLISHER_REQUIRED)
    expect(await statusOf(edition.id)).toBe("compiled")
  })

  it("Given a compile intent without artifact metadata, when compilation is attempted, then it is rejected", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)
    await recordAssessmentFor(edition.id, "passed")
    await transitionEdition(payload, { editionId: edition.id, target: "approved", user: reviewer })

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "compiled", user: publisher }),
    )
    expect(code).toBe("EDITION_WORKFLOW_RELEASE_REQUIRED")
    expect(await statusOf(edition.id)).toBe("approved")
  })

  it("Given an edition without a compiled release, when publication is attempted, then it is rejected", async () => {
    const edition = await makeEdition()
    await advanceToReview(edition.id)

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "published", user: publisher }),
    )
    expect(code).toBe("EDITION_WORKFLOW_NOT_COMPILED")
    expect(await statusOf(edition.id)).toBe("review")
  })

  it("Given an unreachable target state, when the transition is attempted, then the state machine rejects it", async () => {
    const edition = await makeEdition()

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "archived", user: publisher }),
    )
    expect(code).toBe(DOMAIN_ERROR_CODE.CONTENT_EDITION_TRANSITION_NOT_ALLOWED)
    expect(await statusOf(edition.id)).toBe("draft")
  })

  it("Given an anonymous caller, when a transition is attempted, then no actor can be resolved", async () => {
    const edition = await makeEdition()

    const code = await failureCodeOf(() =>
      transitionEdition(payload, { editionId: edition.id, target: "generating", user: null }),
    )
    expect(code).toBe("EDITION_WORKFLOW_ACTOR_INVALID")
    expect(await statusOf(edition.id)).toBe("draft")
  })

  it("Given locked workflow fields, when an editor writes them directly, then the values are ignored", async () => {
    const edition = await makeEdition()
    await payload.update({
      collection: "content-editions",
      id: edition.id,
      data: {
        workflowStatus: "published",
        workflowRevision: 99,
        compiledRelease: "forged-release",
        auditLog: [{ action: "forged" }],
      },
      ...asUser(editor),
    })

    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(doc.workflowStatus).toBe("draft")
    expect(Number(doc.workflowRevision)).toBe(0)
    expect(doc.compiledRelease).toBeFalsy()
    expect(await auditOf(edition.id)).toEqual([])
  })

  it("Given a published edition, when an editor opens a new version, then a superseding draft is created and the live record keeps serving", async () => {
    const edition = await makeEdition()
    await advanceToCompiled(edition.id, "release-2026-08-18-supersede")
    await transitionEdition(payload, {
      editionId: edition.id,
      target: "published",
      user: publisher,
    })

    await createDraftFromPublished(payload, edition.id, editor, "revise after launch")

    const live = await loadWorkflowEdition(payload, edition.id)
    expect(live.workflowStatus).toBe("published")
    expect(live.compiledRelease).toBe("release-2026-08-18-supersede")

    const superseding = (await payload.findByID({
      collection: "content-editions",
      id: edition.id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    })) as unknown as WorkflowEditionDoc
    expect(superseding.workflowStatus).toBe("draft")
    expect(Number(superseding.workflowRevision)).toBe(0)
    expect(superseding.compiledRelease).toBeFalsy()

    const audit = Array.isArray(superseding.auditLog) ? (superseding.auditLog as AuditEntry[]) : []
    const supersession = audit.at(-1)
    expect(supersession?.action).toBe("content-edition.published.draft")
    expect(supersession?.to).toBe("draft")
    expect(supersession?.actor.role).toBe("editor")
    expect(supersession?.reason).toBe("revise after launch")
  })

  it("Given a non-published edition, when a new version is requested, then the source guard rejects it", async () => {
    const edition = await makeEdition()

    const code = await failureCodeOf(() => createDraftFromPublished(payload, edition.id, editor))
    expect(code).toBe(DOMAIN_ERROR_CODE.CONTENT_EDITION_SOURCE_NOT_PUBLISHED)
    expect(await statusOf(edition.id)).toBe("draft")
  })

  it("Given a publisher, when a new version is requested, then the editor guard rejects it", async () => {
    const edition = await makeEdition()
    await advanceToCompiled(edition.id, "release-2026-08-18-editor-guard")
    await transitionEdition(payload, {
      editionId: edition.id,
      target: "published",
      user: publisher,
    })

    const code = await failureCodeOf(() => createDraftFromPublished(payload, edition.id, publisher))
    expect(code).toBe(DOMAIN_ERROR_CODE.CONTENT_EDITION_EDITOR_REQUIRED)
    expect(await statusOf(edition.id)).toBe("published")
  })

  it("Given recorded assessments, when they are read back, then the evidence keeps its immutable inputs", async () => {
    const edition = await makeEdition()
    const assessmentId = await recordAssessmentFor(edition.id, "passed", [
      { code: "MINOR_STYLE", severity: "info" },
    ])

    const stored = await payload.findByID({
      collection: "quality-assessments",
      id: assessmentId,
      depth: 0,
      overrideAccess: true,
    })
    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(stored.state).toBe("passed")
    expect(stored.inputHash).toBe(currentEditionInputHash(doc))
    expect(stored.modelId).toBe("quality-model-v1")
    expect(stored.promptVersion).toBe("2026-08-18")
    expect(stored.thresholdsHash).toBe("thresholds-sha256-fixture")
    expect(Number(stored.tenant)).toBe(Number(tenant.id))
  })
})

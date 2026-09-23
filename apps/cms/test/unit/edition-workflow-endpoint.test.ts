import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  transition,
  createDraftFromPublished,
  submitPublish,
  loadVersion,
  memberSiteIdsOf,
} = vi.hoisted(() => ({
  transition: vi.fn(),
  createDraftFromPublished: vi.fn(),
  submitPublish: vi.fn(),
  loadVersion: vi.fn(),
  memberSiteIdsOf: vi.fn(),
}))

const authState = { claims: { kind: "user", role: "editor", tenantId: 4, userId: "7" } }

vi.mock("../../src/server/runtime", () => ({
  serverRuntime: () => ({
    db: { transaction: async (run: (tx: unknown) => unknown) => run({}) },
  }),
}))

vi.mock("../../src/server/auth/session", () => ({
  authenticateRequest: vi.fn(async () => ({
    claims: authState.claims,
    session: null,
    siteIds: [],
    user: {},
  })),
}))

vi.mock("../../src/server/repositories/entities", () => ({
  entityScopeOf: () => ({ kind: "tenant", tenantId: 4 }),
}))

vi.mock("../../src/server/repositories/edition-workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/repositories/edition-workflow")>()),
  WorkflowRepository: class {
    transition = transition
    createDraftFromPublished = createDraftFromPublished
  },
  loadCurrentVersion: loadVersion,
}))

vi.mock("../../src/server/repositories/operations", () => ({
  OperationsRepository: class {
    submit = submitPublish
  },
}))

vi.mock("../../src/server/repositories/edition-sites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/repositories/edition-sites")>()),
  memberSiteIdsOf,
}))

import {
  editionWorkflowRouteOf,
  handleEditionWorkflowPost,
} from "../../src/server/routes/edition-workflow"
import { WorkflowRepositoryError } from "../../src/server/repositories/edition-workflow"

const versionRow = (workflowStatus: string) => ({
  root: { id: 586 },
  version: {
    compiledRelease: null,
    siteId: 374,
    sites: [],
    tenantId: 4,
    workflowRevision: "3",
    workflowStatus,
  },
})

const post = async (slug: readonly string[], body: unknown): Promise<Response> => {
  const response = await handleEditionWorkflowPost(
    new Request(`http://local/api/${slug.join("/")}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    slug,
  )
  if (response === null) throw new Error(`route not matched: ${slug.join("/")}`)
  return response
}

describe("edition workflow Drizzle routes", () => {
  beforeEach(() => {
    transition.mockReset()
    createDraftFromPublished.mockReset()
    submitPublish.mockReset()
    loadVersion.mockReset()
    memberSiteIdsOf.mockReset()
    memberSiteIdsOf.mockResolvedValue([374])
    authState.claims = { kind: "user", role: "editor", tenantId: 4, userId: "7" }
  })

  it("claims only the three workflow POST routes", () => {
    expect(editionWorkflowRouteOf(["editions", "586", "workflow-transitions"])).toBe("transition")
    expect(editionWorkflowRouteOf(["editions", "586", "draft-from-published"])).toBe("draft")
    expect(editionWorkflowRouteOf(["editions", "586", "publish-operations"])).toBe("publish")
    expect(editionWorkflowRouteOf(["editions", "586", "restore-draft"])).toBeNull()
    expect(editionWorkflowRouteOf(["workspaces", "editions", "586", "version-history"])).toBeNull()
    expect(editionWorkflowRouteOf(undefined)).toBeNull()
  })

  it("rejects invalid ids and blank reasons before touching the repository", async () => {
    const invalidId = await post(["editions", "abc", "workflow-transitions"], {
      target: "review",
    })
    expect(invalidId.status).toBe(400)
    expect(await invalidId.json()).toEqual({ error: { code: "EDITION_WORKFLOW_ID_INVALID" } })

    const blankReason = await post(["editions", "586", "workflow-transitions"], {
      reason: "   ",
      target: "review",
    })
    expect(blankReason.status).toBe(400)
    expect(await blankReason.json()).toEqual({ error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    expect(transition).not.toHaveBeenCalled()
  })

  it("returns the transitioned state on success", async () => {
    transition.mockResolvedValueOnce("review")
    const response = await post(["editions", "586", "workflow-transitions"], { target: "review" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ editionId: 586, workflowStatus: "review" })
    expect(transition).toHaveBeenCalledWith(
      { kind: "tenant", tenantId: 4 },
      expect.objectContaining({ editionId: 586, target: "review" }),
    )
  })

  it("maps tenant mismatches to 403 and revision conflicts to 409", async () => {
    transition.mockRejectedValueOnce(
      new WorkflowRepositoryError("EDITION_WORKFLOW_TENANT_MISMATCH"),
    )
    const forbidden = await post(["editions", "586", "workflow-transitions"], {
      target: "review",
    })

    transition.mockRejectedValueOnce(
      new WorkflowRepositoryError("EDITION_WORKFLOW_REVISION_CONFLICT"),
    )
    const conflict = await post(["editions", "586", "workflow-transitions"], {
      target: "approved",
    })

    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_TENANT_MISMATCH" },
    })
    expect(conflict.status).toBe(409)
  })

  it("keeps the draft-from-published response contract", async () => {
    createDraftFromPublished.mockResolvedValueOnce(undefined)
    const response = await post(["editions", "586", "draft-from-published"], {})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ editionId: 586, workflowStatus: "draft" })
  })

  it("gates publish operations on the publisher role and the approved state", async () => {
    loadVersion.mockResolvedValueOnce(versionRow("approved"))
    const forbidden = await post(["editions", "586", "publish-operations"], {})

    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_PUBLISHER_REQUIRED" },
    })

    authState.claims = { kind: "user", role: "publisher", tenantId: 4, userId: "9" }
    loadVersion.mockResolvedValueOnce(versionRow("draft"))
    const notApproved = await post(["editions", "586", "publish-operations"], {})

    expect(notApproved.status).toBe(409)
    expect(await notApproved.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_NOT_APPROVED" },
    })
    expect(submitPublish).not.toHaveBeenCalled()
  })

  it("returns 202 for created publish operations and 200 for replays", async () => {
    authState.claims = { kind: "user", role: "publisher", tenantId: 4, userId: "9" }
    loadVersion.mockResolvedValue(versionRow("approved"))
    submitPublish.mockResolvedValueOnce({ created: true, operationId: "op-1", state: "queued" })
    const created = await post(["editions", "586", "publish-operations"], {})

    submitPublish.mockResolvedValueOnce({
      created: false,
      operationId: "op-1",
      state: "succeeded",
    })
    const replayed = await post(["editions", "586", "publish-operations"], {})

    // 单站：保持旧响应形状（operation 单数，A2 基线兼容）
    expect(created.status).toBe(202)
    expect((await created.json()).operation).toMatchObject({
      created: true,
      operationId: "op-1",
      siteId: 374,
    })
    expect(replayed.status).toBe(200)
    expect((await replayed.json()).operation).toMatchObject({
      created: false,
      state: "succeeded",
    })
  })

  it("fans out one operation per member site and responds with an operations array", async () => {
    authState.claims = { kind: "user", role: "publisher", tenantId: 4, userId: "9" }
    loadVersion.mockResolvedValue({
      ...versionRow("approved"),
      version: { ...versionRow("approved").version, sites: [375] },
    })
    memberSiteIdsOf.mockResolvedValue([374, 375])
    submitPublish.mockImplementation(async (input: { siteId?: number }) => {
      const siteId = input.siteId ?? 374
      return { created: true, operationId: `op-${siteId}`, state: "queued" as const }
    })
    const fanned = await post(["editions", "586", "publish-operations"], {})
    const body = (await fanned.json()) as {
      operations?: { created: boolean; operationId: string; siteId: number }[]
    }

    expect(fanned.status).toBe(202)
    expect(submitPublish).toHaveBeenCalledTimes(2)
    expect(
      submitPublish.mock.calls.map((call) => call[0]?.siteId).sort((a, b) => a - b),
    ).toEqual([374, 375])
    expect(body.operations?.map((operation) => operation.siteId).sort((a, b) => a - b)).toEqual([
      374, 375,
    ])
    expect(body.operations?.every((operation) => operation.created)).toBe(true)
  })

  it("rejects an explicit siteId that is not a member site", async () => {
    authState.claims = { kind: "user", role: "publisher", tenantId: 4, userId: "9" }
    loadVersion.mockResolvedValue(versionRow("approved"))
    memberSiteIdsOf.mockResolvedValue([374])
    const rejected = await post(["editions", "586", "publish-operations"], { siteId: 999 })

    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_SITE_NOT_ASSIGNED" },
    })
    expect(submitPublish).not.toHaveBeenCalled()
  })
})

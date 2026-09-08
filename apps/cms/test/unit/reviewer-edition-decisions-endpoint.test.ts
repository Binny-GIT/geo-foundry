import { beforeEach, describe, expect, it, vi } from "vitest"

const { submitDecision } = vi.hoisted(() => ({ submitDecision: vi.fn() }))

const authState = { claims: { kind: "user", role: "reviewer", tenantId: 4, userId: "8" } }

vi.mock("../../src/server/runtime", () => ({
  serverRuntime: () => ({ db: {} }),
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

vi.mock("../../src/server/repositories/reviewer-decisions", () => ({
  ReviewerDecisionRepositoryError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  ReviewerDecisionsRepository: class {
    submit = submitDecision
  },
}))

import { handleReviewerDecisionPost } from "../../src/server/routes/reviewer-decisions"
import { WorkflowRepositoryError } from "../../src/server/repositories/edition-workflow"
import { ReviewerDecisionRepositoryError } from "../../src/server/repositories/reviewer-decisions"

const post = async (
  slug: readonly string[],
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const response = await handleReviewerDecisionPost(
    new Request(`http://local/api/${slug.join("/")}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    }),
    slug,
  )
  if (response === null) throw new Error(`route not matched: ${slug.join("/")}`)
  return response
}

const approveSlug = ["workspaces", "reviewer", "editions", "586", "approve"]
const headers = { "idempotency-key": "rev-decision-0001", "x-request-id": "rev-req-0001" }

describe("reviewer decision Drizzle routes", () => {
  beforeEach(() => {
    submitDecision.mockReset()
    authState.claims = { kind: "user", role: "reviewer", tenantId: 4, userId: "8" }
  })

  it("approves with the stored response and echoes the request id", async () => {
    submitDecision.mockResolvedValueOnce({
      created: true,
      response: { editionId: 586, workflowRevision: 4, workflowStatus: "approved" },
    })
    const response = await post(approveSlug, { expectedRevision: 3 }, headers)

    expect(response.status).toBe(200)
    expect(response.headers.get("x-request-id")).toBe("rev-req-0001")
    expect(await response.json()).toEqual({
      editionId: 586,
      workflowRevision: 4,
      workflowStatus: "approved",
    })
    expect(submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 3,
        idempotencyKey: "rev-decision-0001",
        target: "approved",
      }),
    )
  })

  it("requires strict bodies, idempotency keys, and reviewer identity", async () => {
    const missingReason = await post(
      ["workspaces", "reviewer", "editions", "586", "request-changes"],
      { expectedRevision: 3 },
      headers,
    )
    const badKey = await post(
      approveSlug,
      { expectedRevision: 3 },
      { ...headers, "idempotency-key": "short" },
    )

    authState.claims = { kind: "user", role: "editor", tenantId: 4, userId: "7" }
    const wrongRole = await post(approveSlug, { expectedRevision: 3 }, headers)

    expect(missingReason.status).toBe(400)
    expect(badKey.status).toBe(400)
    expect(await badKey.json()).toEqual({
      error: { code: "REVIEWER_EDITION_IDEMPOTENCY_KEY_INVALID" },
    })
    expect(wrongRole.status).toBe(403)
    expect(submitDecision).not.toHaveBeenCalled()
  })

  it("masks missing and foreign editions as the same 404 envelope", async () => {
    submitDecision.mockRejectedValueOnce(new WorkflowRepositoryError("EDITION_WORKFLOW_NOT_FOUND"))
    const missing = await post(approveSlug, { expectedRevision: 3 }, headers)

    submitDecision.mockRejectedValueOnce(
      new WorkflowRepositoryError("EDITION_WORKFLOW_TENANT_MISMATCH"),
    )
    const foreign = await post(approveSlug, { expectedRevision: 3 }, headers)

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(await missing.json()).toEqual(await foreign.json())
  })

  it("maps idempotency reuse and revision conflicts to 409", async () => {
    submitDecision.mockRejectedValueOnce(
      new ReviewerDecisionRepositoryError("IDEMPOTENCY_KEY_REUSED"),
    )
    const reused = await post(approveSlug, { expectedRevision: 3 }, headers)

    submitDecision.mockRejectedValueOnce(
      new WorkflowRepositoryError("EDITION_WORKFLOW_REVISION_CONFLICT"),
    )
    const conflict = await post(approveSlug, { expectedRevision: 9 }, headers)

    expect(reused.status).toBe(409)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_REVISION_CONFLICT" },
    })
  })
})

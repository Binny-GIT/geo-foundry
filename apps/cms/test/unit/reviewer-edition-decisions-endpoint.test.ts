import type { PayloadRequest } from "payload"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { MockEditionWorkflowError, MockReviewerEditionDecisionError, submitReviewerEditionDecision } =
  vi.hoisted(() => ({
    MockEditionWorkflowError: class MockEditionWorkflowError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    MockReviewerEditionDecisionError: class MockReviewerEditionDecisionError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    submitReviewerEditionDecision: vi.fn(),
  }))

vi.mock("../../src/services/edition-workflow", () => ({
  EditionWorkflowError: MockEditionWorkflowError,
}))

vi.mock("../../src/services/reviewer-edition-decisions", () => ({
  ReviewerEditionDecisionError: MockReviewerEditionDecisionError,
  submitReviewerEditionDecision,
}))

import {
  reviewerApproveEditionEndpoint,
  reviewerRequestChangesEditionEndpoint,
} from "../../src/endpoints/reviewer-edition-decisions"

const reviewer = { id: 4, role: "reviewer", tenant: { id: 7 } }

const requestOf = (
  body: unknown,
  options: {
    readonly id?: string
    readonly user?: unknown
    readonly headers?: Record<string, string>
  } = {},
): PayloadRequest =>
  ({
    headers: new Headers({
      "idempotency-key": "reviewer-decision-101",
      "x-request-id": "reviewer-request-101",
      ...options.headers,
    }),
    json: async () => body,
    payload: {},
    routeParams: { id: options.id ?? "101" },
    user: Object.hasOwn(options, "user") ? options.user : reviewer,
  }) as unknown as PayloadRequest

describe("reviewer edition decision endpoints", () => {
  beforeEach(() => {
    submitReviewerEditionDecision.mockReset()
  })

  it("submits approval with a fixed target and session-bound reviewer context", async () => {
    submitReviewerEditionDecision.mockResolvedValueOnce({
      created: true,
      response: { editionId: 101, workflowRevision: 4, workflowStatus: "approved" },
    })

    const response = await reviewerApproveEditionEndpoint.handler(
      requestOf({ expectedRevision: 3 }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      editionId: 101,
      workflowRevision: 4,
      workflowStatus: "approved",
    })
    expect(submitReviewerEditionDecision).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        editionId: 101,
        expectedRevision: 3,
        idempotencyKey: "reviewer-decision-101",
        requestId: "reviewer-request-101",
        target: "approved",
        user: reviewer,
      }),
    )
  })

  it("requires and trims the request-changes reason before the service runs", async () => {
    const invalid = await reviewerRequestChangesEditionEndpoint.handler(
      requestOf({ expectedRevision: 3, reason: "   " }),
    )
    expect(invalid.status).toBe(400)
    expect(submitReviewerEditionDecision).not.toHaveBeenCalled()

    submitReviewerEditionDecision.mockResolvedValueOnce({
      created: true,
      response: { editionId: 101, workflowRevision: 4, workflowStatus: "draft" },
    })
    const valid = await reviewerRequestChangesEditionEndpoint.handler(
      requestOf({ expectedRevision: 3, reason: "  clarify the primary claim  " }),
    )

    expect(valid.status).toBe(200)
    expect(submitReviewerEditionDecision).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ reason: "clarify the primary claim", target: "draft" }),
    )
  })

  it("rejects unauthenticated and every non-reviewer identity before target lookup", async () => {
    const anonymous = await reviewerApproveEditionEndpoint.handler(
      requestOf({ expectedRevision: 3 }, { user: null }),
    )
    expect(anonymous.status).toBe(401)

    for (const role of ["content-service", "editor", "publisher", "tenant-admin"]) {
      const forbidden = await reviewerApproveEditionEndpoint.handler(
        requestOf({ expectedRevision: 3 }, { user: { id: 5, role, tenant: { id: 7 } } }),
      )
      expect(forbidden.status).toBe(403)
    }
    expect(submitReviewerEditionDecision).not.toHaveBeenCalled()
  })

  it("accepts a cross-tenant super-admin decision before target lookup", async () => {
    const granted = await reviewerApproveEditionEndpoint.handler(
      requestOf({ expectedRevision: 3 }, { user: { id: 5, role: "super-admin" } }),
    )
    expect(granted.status).toBe(200)
    expect(submitReviewerEditionDecision).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ target: "approved" }),
    )
  })

  it("rejects malformed route, headers, and strict request fields", async () => {
    expect(
      (
        await reviewerApproveEditionEndpoint.handler(
          requestOf({ expectedRevision: 3 }, { id: "not-an-id" }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await reviewerApproveEditionEndpoint.handler(
          requestOf({ expectedRevision: 3 }, { headers: { "idempotency-key": "short" } }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await reviewerApproveEditionEndpoint.handler(
          requestOf({ expectedRevision: 3, target: "draft" }),
        )
      ).status,
    ).toBe(400)
    expect(submitReviewerEditionDecision).not.toHaveBeenCalled()
  })

  it("uses one indistinguishable 404 envelope for missing and foreign editions", async () => {
    submitReviewerEditionDecision.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_NOT_FOUND"),
    )
    const missing = await reviewerApproveEditionEndpoint.handler(requestOf({ expectedRevision: 3 }))

    submitReviewerEditionDecision.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_TENANT_MISMATCH"),
    )
    const foreign = await reviewerApproveEditionEndpoint.handler(requestOf({ expectedRevision: 3 }))

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await foreign.text()).toBe(await missing.text())
  })

  it("maps revision conflicts to an actionable conflict response", async () => {
    submitReviewerEditionDecision.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_REVISION_CONFLICT"),
    )

    const response = await reviewerApproveEditionEndpoint.handler(
      requestOf({ expectedRevision: 3 }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_REVISION_CONFLICT" },
    })
  })
})

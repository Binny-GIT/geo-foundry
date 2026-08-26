import type { PayloadRequest } from "payload"
import { describe, expect, it, vi } from "vitest"

const submitEditionPublishOperation = vi.hoisted(() => vi.fn())
const transitionEdition = vi.hoisted(() => vi.fn())

vi.mock("../../src/services/edition-workflow", () => ({
  EditionWorkflowError: class EditionWorkflowError extends Error {},
  createDraftFromPublished: vi.fn(),
  transitionEdition,
}))

vi.mock("../../src/services/operations-ledger", () => ({
  OperationsLedgerError: class OperationsLedgerError extends Error {},
  submitEditionPublishOperation,
}))

import {
  submitPublishOperationEndpoint,
  transitionEditionEndpoint,
} from "../../src/endpoints/edition-workflow"

const requestOf = (body: unknown): PayloadRequest =>
  ({
    json: async () => body,
    payload: {},
    routeParams: { id: "101" },
    user: { id: 4, role: "reviewer", tenant: { id: 7 } },
  }) as unknown as PayloadRequest

describe("edition workflow endpoint", () => {
  it("rejects an empty workflow reason before it reaches the service", async () => {
    const response = await transitionEditionEndpoint.handler(requestOf({ reason: "   ", target: "draft" }))

    expect(response.status).toBe(400)
    expect(transitionEdition).not.toHaveBeenCalled()
  })

  it("accepts a reviewer request to return a review edition to draft", async () => {
    transitionEdition.mockResolvedValueOnce("draft")

    const response = await transitionEditionEndpoint.handler(
      requestOf({ reason: "quality evidence requires one revision", target: "draft" }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ editionId: 101, workflowStatus: "draft" })
    expect(transitionEdition).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        editionId: 101,
        reason: "quality evidence requires one revision",
        target: "draft",
      }),
    )
  })

  it("forwards an optional publish reason to the idempotent operations service", async () => {
    submitEditionPublishOperation.mockResolvedValueOnce({
      created: true,
      operationId: "operation-101",
      releaseId: "release-101",
      state: "queued",
    })

    const response = await submitPublishOperationEndpoint.handler(
      requestOf({ reason: "approved launch window" }),
    )

    expect(response.status).toBe(202)
    expect(submitEditionPublishOperation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        editionId: 101,
        reason: "approved launch window",
      }),
    )
  })
})

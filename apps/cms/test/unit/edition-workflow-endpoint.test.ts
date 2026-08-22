import type { PayloadRequest } from "payload"
import { describe, expect, it, vi } from "vitest"

const transitionEdition = vi.hoisted(() => vi.fn())

vi.mock("../../src/services/edition-workflow", () => ({
  EditionWorkflowError: class EditionWorkflowError extends Error {},
  createDraftFromPublished: vi.fn(),
  transitionEdition,
}))

import { transitionEditionEndpoint } from "../../src/endpoints/edition-workflow"

const requestOf = (body: unknown): PayloadRequest =>
  ({
    json: async () => body,
    payload: {},
    routeParams: { id: "101" },
    user: { id: 4, role: "reviewer", tenant: { id: 7 } },
  }) as unknown as PayloadRequest

describe("edition workflow endpoint", () => {
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
})

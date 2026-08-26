import type { PayloadRequest } from "payload"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { MockEditionVersionHistoryError, MockWorkflowError, editionVersionHistory, restoreEditionDraft } =
  vi.hoisted(() => ({
    MockEditionVersionHistoryError: class MockEditionVersionHistoryError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    MockWorkflowError: class MockWorkflowError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    editionVersionHistory: vi.fn(),
    restoreEditionDraft: vi.fn(),
  }))

vi.mock("../../src/services/edition-workflow", () => ({
  EditionWorkflowError: MockWorkflowError,
}))

vi.mock("../../src/services/edition-version-history", () => ({
  EditionVersionHistoryError: MockEditionVersionHistoryError,
  editionVersionHistory,
  restoreEditionDraft,
}))

import {
  editionVersionHistoryEndpoint,
  restoreEditionDraftEndpoint,
} from "../../src/endpoints/edition-version-history"

const editor = { id: 7, role: "editor", tenant: { id: 4 } }
const reviewer = { id: 8, role: "reviewer", tenant: { id: 4 } }

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
      "idempotency-key": "edition-restore-0001",
      "x-request-id": "edition-restore-req-01",
      ...options.headers,
    }),
    json: async () => body,
    payload: {},
    routeParams: { id: options.id ?? "101" },
    user: Object.hasOwn(options, "user") ? options.user : editor,
  }) as unknown as PayloadRequest

const restoreBody = {
  expectedRevision: 3,
  expectedUpdatedAt: "2026-08-26T10:00:00.000Z",
  reason: "Restore the approved editorial baseline.",
  versionId: 1462,
}

describe("edition version history endpoints", () => {
  beforeEach(() => {
    editionVersionHistory.mockReset()
    restoreEditionDraft.mockReset()
  })

  it("returns only the service-provided safe history DTO for an authenticated user", async () => {
    editionVersionHistory.mockResolvedValueOnce([
      {
        createdAt: "2026-08-26T10:00:00.000Z",
        draft: true,
        id: "1c9e4fa0-7e2a-4bd8-a2c2-83e986fea213",
        latest: true,
        snapshot: {
          angle: "baseline",
          body: [{ blockType: "paragraph", text: "Read-only snapshot" }],
          citations: null,
          creationOrigin: "human",
          entities: null,
          primaryTopic: "topic",
          secondaryTopics: [],
          summary: "Summary",
          title: "Title",
        },
        updatedAt: "2026-08-26T10:00:00.000Z",
        workflowStatus: "draft",
      },
    ])

    const response = await editionVersionHistoryEndpoint.handler(requestOf(undefined))

    expect(response.status).toBe(200)
    expect(editionVersionHistory).toHaveBeenCalledWith({}, { editionId: 101, user: editor })
  })

  it("requires an editor, a strict body, and safe idempotency headers before restore", async () => {
    const reviewerResponse = await restoreEditionDraftEndpoint.handler(
      requestOf(restoreBody, { user: reviewer }),
    )
    const invalidBodyResponse = await restoreEditionDraftEndpoint.handler(
      requestOf({ ...restoreBody, extra: true }),
    )
    const invalidKeyResponse = await restoreEditionDraftEndpoint.handler(
      requestOf(restoreBody, { headers: { "idempotency-key": "short" } }),
    )

    expect(reviewerResponse.status).toBe(403)
    expect(invalidBodyResponse.status).toBe(400)
    expect(invalidKeyResponse.status).toBe(400)
    expect(restoreEditionDraft).not.toHaveBeenCalled()
  })

  it("trims reason and forwards the fixed route identity to the restore service", async () => {
    restoreEditionDraft.mockResolvedValueOnce({
      created: true,
      response: {
        editionId: 101,
        restoredVersionId: restoreBody.versionId,
        updatedAt: "2026-08-26T10:01:00.000Z",
      },
    })

    const response = await restoreEditionDraftEndpoint.handler(
      requestOf({ ...restoreBody, reason: "  Restore the approved editorial baseline.  " }),
    )

    expect(response.status).toBe(200)
    expect(restoreEditionDraft).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        editionId: 101,
        idempotencyKey: "edition-restore-0001",
        reason: "Restore the approved editorial baseline.",
        user: editor,
        versionId: restoreBody.versionId,
      }),
    )
  })

  it("returns the same 404 body for foreign and unknown editions", async () => {
    editionVersionHistory.mockRejectedValueOnce(
      new MockEditionVersionHistoryError("EDITION_VERSION_NOT_FOUND"),
    )
    const missing = await editionVersionHistoryEndpoint.handler(requestOf(undefined))

    editionVersionHistory.mockRejectedValueOnce(
      new MockWorkflowError("EDITION_WORKFLOW_TENANT_MISMATCH"),
    )
    const foreign = await editionVersionHistoryEndpoint.handler(requestOf(undefined))

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(await missing.text()).toBe(await foreign.text())
  })

  it("maps stale restore requests to a conflict without returning record details", async () => {
    restoreEditionDraft.mockRejectedValueOnce(
      new MockWorkflowError("EDITION_WORKFLOW_REVISION_CONFLICT"),
    )

    const response = await restoreEditionDraftEndpoint.handler(requestOf(restoreBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: "EDITION_WORKFLOW_REVISION_CONFLICT" },
    })
  })
})

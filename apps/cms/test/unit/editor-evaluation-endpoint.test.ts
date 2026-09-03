import type { PayloadRequest } from "payload"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { MockEditionWorkflowError, MockOperationsLedgerError, submitEditionEvaluationOperation } =
  vi.hoisted(() => ({
    MockEditionWorkflowError: class MockEditionWorkflowError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    MockOperationsLedgerError: class MockOperationsLedgerError extends Error {
      constructor(readonly code: string) {
        super(code)
      }
    },
    submitEditionEvaluationOperation: vi.fn(),
  }))

vi.mock("../../src/services/edition-workflow", () => ({
  EditionWorkflowError: MockEditionWorkflowError,
}))

vi.mock("../../src/services/operations-ledger", () => ({
  OperationsLedgerError: MockOperationsLedgerError,
  submitEditionEvaluationOperation,
}))

import { submitEditorEvaluationEndpoint } from "../../src/endpoints/editor-evaluation"

const editor = { id: 4, role: "editor", tenant: { id: 7 } }

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
      "idempotency-key": "editor-evaluation-101",
      "x-request-id": "editor-evaluation-request-101",
      ...options.headers,
    }),
    json: async () => body,
    payload: {},
    routeParams: { id: options.id ?? "101" },
    user: Object.hasOwn(options, "user") ? options.user : editor,
  }) as unknown as PayloadRequest

describe("editor evaluation endpoint", () => {
  beforeEach(() => {
    submitEditionEvaluationOperation.mockReset()
  })

  it("submits an editor-scoped evaluation intent with strict optional thresholds", async () => {
    submitEditionEvaluationOperation.mockResolvedValueOnce({
      created: true,
      operation: {
        attempt: 1,
        currentStage: null,
        endpoint: "/workspaces/editor/editions/101/evaluation",
        error: null,
        operationId: "11111111-2222-3333-4444-555555555555",
        operationType: "evaluate",
        requestPayload: {
          body: { editionId: 101, thresholds: { dimensionMin: 75, overallMin: 80 } },
        },
        result: null,
        state: "queued",
        tenantId: 7,
      },
    })

    const response = await submitEditorEvaluationEndpoint.handler(
      requestOf({ thresholds: { dimensionMin: 75, overallMin: 80 } }),
    )

    expect(response.status).toBe(202)
    expect(response.headers.get("x-request-id")).toBe("editor-evaluation-request-101")
    expect(submitEditionEvaluationOperation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        editionId: 101,
        idempotencyKey: "editor-evaluation-101",
        requestId: "editor-evaluation-request-101",
        thresholds: { dimensionMin: 75, overallMin: 80 },
        user: editor,
      }),
    )
  })

  it("returns 200 for an exact replay", async () => {
    submitEditionEvaluationOperation.mockResolvedValueOnce({
      created: false,
      operation: { operationId: "11111111-2222-3333-4444-555555555555", state: "queued" },
    })

    const response = await submitEditorEvaluationEndpoint.handler(requestOf({}))

    expect(response.status).toBe(200)
    expect((await response.json()).created).toBe(false)
  })

  it("rejects anonymous, non-editor, malformed route/header, and strict body input", async () => {
    expect(
      (await submitEditorEvaluationEndpoint.handler(requestOf({}, { user: null }))).status,
    ).toBe(401)
    for (const role of [
      "reviewer",
      "publisher",
      "tenant-admin",
      "super-admin",
      "content-service",
    ]) {
      const user = role === "super-admin" ? { id: 5, role } : { id: 5, role, tenant: { id: 7 } }
      expect((await submitEditorEvaluationEndpoint.handler(requestOf({}, { user }))).status).toBe(
        403,
      )
    }
    expect(
      (await submitEditorEvaluationEndpoint.handler(requestOf({}, { id: "bad" }))).status,
    ).toBe(400)
    expect(
      (
        await submitEditorEvaluationEndpoint.handler(
          requestOf({}, { headers: { "idempotency-key": "short" } }),
        )
      ).status,
    ).toBe(400)
    expect(
      (await submitEditorEvaluationEndpoint.handler(requestOf({ ignored: true }))).status,
    ).toBe(400)
    expect(submitEditionEvaluationOperation).not.toHaveBeenCalled()
  })

  it("uses one 404 envelope for missing and foreign editions", async () => {
    submitEditionEvaluationOperation.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_NOT_FOUND"),
    )
    const missing = await submitEditorEvaluationEndpoint.handler(requestOf({}))
    submitEditionEvaluationOperation.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_TENANT_MISMATCH"),
    )
    const foreign = await submitEditorEvaluationEndpoint.handler(requestOf({}))

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(await missing.text()).toBe(await foreign.text())
  })

  it("maps idempotency reuse and workflow conflicts", async () => {
    submitEditionEvaluationOperation.mockRejectedValueOnce(
      new MockOperationsLedgerError("IDEMPOTENCY_KEY_REUSED"),
    )
    expect((await submitEditorEvaluationEndpoint.handler(requestOf({}))).status).toBe(409)

    submitEditionEvaluationOperation.mockRejectedValueOnce(
      new MockEditionWorkflowError("EDITION_WORKFLOW_EVALUATION_NOT_ALLOWED"),
    )
    expect((await submitEditorEvaluationEndpoint.handler(requestOf({}))).status).toBe(409)
  })
})

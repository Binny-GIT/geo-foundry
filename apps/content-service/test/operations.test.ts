import { describe, expect, it, vi } from "vitest"

import { ContentClientError, ContentServiceClient } from "@geo/content-client"

import { OperationsLedger } from "../src/operations/ledger.js"
import { recoveryJobPlanOf } from "../src/operations/job-ids.js"

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  attempt: 1,
  currentStage: null,
  endpoint: "/v1/generate",
  error: null,
  operationId: "11111111-2222-3333-4444-555555555555",
  operationType: "generate",
  result: null,
  state: "queued",
  tenantId: 7,
  ...overrides,
})

const clientWithFetch = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { "x-request-id": "srv-1" },
        status,
      }),
  )
  return {
    client: new ContentServiceClient({
      apiKey: "key",
      baseUrl: "http://cms.test",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    }),
    fetchMock,
  }
}

const submitRequest = {
  endpoint: "/v1/generate",
  idempotencyKey: "key-0001-abcd",
  operationType: "generate",
  requestPayload: { topic: "ai" },
}

describe("operations ledger facade", () => {
  it("maps a 202 created submit into the created variant", async () => {
    const { client } = clientWithFetch({ created: true, operation: snapshot() }, 202)
    const ledger = new OperationsLedger(client)
    const outcome = await ledger.submit(submitRequest)
    expect(outcome.kind).toBe("created")
    expect(outcome.kind === "created" && outcome.operation.state).toBe("queued")
  })

  it("maps a 200 replay submit into the replay variant", async () => {
    const { client } = clientWithFetch(
      { created: false, operation: snapshot({ state: "running", currentStage: "generate-draft" }) },
      200,
    )
    const ledger = new OperationsLedger(client)
    const outcome = await ledger.submit(submitRequest)
    expect(outcome.kind).toBe("replay")
    expect(outcome.kind === "replay" && outcome.operation.currentStage).toBe("generate-draft")
  })

  it("propagates reused-key failures as typed client errors", async () => {
    const { client } = clientWithFetch(
      { error: { code: "IDEMPOTENCY_KEY_REUSED", requestId: "srv-2" } },
      409,
    )
    const ledger = new OperationsLedger(client)
    const failure = await ledger.submit(submitRequest).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ContentClientError)
    expect((failure as ContentClientError).code).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  it("sends stage completions with attempt and outcome envelopes", async () => {
    const { client, fetchMock } = clientWithFetch({
      operation: snapshot({ state: "succeeded", result: { editionId: 12 } }),
    })
    const ledger = new OperationsLedger(client)
    const done = await ledger.completeStage(snapshot().operationId, {
      attempt: 1,
      outcome: "succeeded",
      result: { editionId: 12 },
      stage: "generate-draft",
    })
    expect(done.state).toBe("succeeded")
    const init = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined) ?? {}
    expect(JSON.parse(String(init.body))).toEqual({
      attempt: 1,
      outcome: "succeeded",
      result: { editionId: 12 },
      stage: "generate-draft",
    })
  })
})

describe("recovery job plan", () => {
  it("derives stable colon-free jobIds for non-terminal operations", () => {
    const plan = recoveryJobPlanOf([
      { currentStage: "generate-draft", operationId: "11111111-2222-3333-4444-555555555555" },
      { currentStage: null, operationId: "99999999-8888-7777-6666-555555555555" },
    ])
    expect(plan).toHaveLength(2)
    expect(plan[0]?.stage).toBe("generate-draft")
    expect(plan[0]?.jobId).toBe("op-11111111-2222-3333-4444-555555555555-generate-draft")
    expect(plan[1]?.stage).toBe("pipeline")
    expect(plan.every((entry) => !entry.jobId.includes(":"))).toBe(true)
  })

  it("rejects unparseable operation ids instead of guessing", () => {
    expect(() => recoveryJobPlanOf([{ currentStage: null, operationId: " padded " }])).toThrow(
      /unparseable operation id/,
    )
  })
})

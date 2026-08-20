import type { OperationSnapshot } from "@geo/content-client"
import { describe, expect, it } from "vitest"

import { createOutboxProcessor } from "../../src/processors/outbox.js"
import { operationFlowOf, operationStageJobId } from "../../src/queues/flows.js"
import { reconcileNonTerminalOperations } from "../../src/reconcile/reconcile.js"

const operation = (overrides: Partial<OperationSnapshot> = {}): OperationSnapshot => ({
  attempt: 1,
  currentStage: null,
  endpoint: "/v1/generate",
  error: null,
  operationId: "11111111-2222-3333-4444-555555555555",
  operationType: "generate",
  requestPayload: { body: { contentId: 12 } },
  result: null,
  state: "queued",
  tenantId: 7,
  ...overrides,
})

describe("operation flows", () => {
  it("derives deterministic stage job ids", () => {
    expect(operationStageJobId("11111111-2222-3333-4444-555555555555", "generation")).toBe(
      "op-11111111-2222-3333-4444-555555555555-generation",
    )
    expect(operationStageJobId("11111111-2222-3333-4444-555555555555", "generation")).toBe(
      operationStageJobId("11111111-2222-3333-4444-555555555555", "generation"),
    )
    expect(() => operationStageJobId("", "generation")).toThrow()
  })

  it("builds publish-rooted flows for generate operations", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "generate",
      payload: { body: {} },
    })
    expect(flow.name).toBe("publish-gate")
    expect(flow.queueName).toBe("content-publish")
    const compile = flow.children?.[0]
    expect(compile?.name).toBe("compile-trigger")
    expect(compile?.children?.[0]?.name).toBe("generation")
    expect(compile?.children?.[0]?.queueName).toBe("content-generation")
    expect(flow.opts?.jobId).toBe("op-11111111-2222-3333-4444-555555555555-publish-gate")
  })

  it("builds a single evaluation job for evaluate operations", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "evaluate",
      payload: {},
    })
    expect(flow.name).toBe("evaluation")
    expect(flow.children).toBeUndefined()
  })

  it("builds a single serial rollback gate without compiler descendants", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "rollback",
      payload: {},
    })
    expect(flow.name).toBe("rollback-gate")
    expect(flow.queueName).toBe("content-publish")
    expect(flow.children).toBeUndefined()
    expect(flow.opts?.jobId).toBe("op-11111111-2222-3333-4444-555555555555-rollback-gate")
  })
})

describe("outbox processor", () => {
  const logs: string[] = []
  const added: { jobId?: string; name: string; data: unknown }[] = []
  const processor = createOutboxProcessor({
    embeddingQueue: {
      add: (async (name: string, data: unknown, opts: { jobId?: string }) => {
        added.push({ data, jobId: opts?.jobId, name })
        return {} as never
      }) as never,
    },
    logger: (event) => logs.push(event.code),
  })

  it("enqueues one stable embedding job per draft-written event", async () => {
    const result = await processor({
      data: { aggregateId: 42, eventId: "evt-1" },
      name: "edition.draft-written",
      queueName: "outbox",
    })
    expect(result).toEqual({ action: "embedding-enqueued", editionId: 42 })
    expect(added).toHaveLength(1)
    expect(added[0]?.jobId).toBe("embed-ed-42")
    await processor({
      data: { aggregateId: 42, eventId: "evt-2" },
      name: "edition.draft-written",
      queueName: "outbox",
    })
    expect(added).toHaveLength(2)
    expect(added[1]?.jobId).toBe("embed-ed-42")
  })

  it("observes informational events without enqueueing", async () => {
    const result = await processor({
      data: { eventId: "evt-3" },
      name: "assessment.recorded",
      queueName: "outbox",
    })
    expect(result).toEqual({ action: "observed", type: "assessment.recorded" })
  })
})

describe("reconciliation", () => {
  it("re-feeds non-terminal operations with their persisted payload", async () => {
    const enqueued: { operationId: string; payload: unknown }[] = []
    const report = await reconcileNonTerminalOperations(
      {
        listNonTerminalOperations: async () => [
          operation(),
          operation({ operationId: "99999999-8888-7777-6666-555555555555", state: "running" }),
        ],
      },
      {
        add: (async (flow: { data: { operationId: string; payload: unknown } }) => {
          enqueued.push(flow.data)
          return {} as never
        }) as never,
      },
    )
    expect(report.enqueued).toHaveLength(2)
    expect(report.failures).toEqual([])
    expect(enqueued[0]?.payload).toEqual({ body: { contentId: 12 } })
  })

  it("skips terminal operations and records failures per operation", async () => {
    const report = await reconcileNonTerminalOperations(
      {
        listNonTerminalOperations: async () => [
          operation({ state: "cancelled" }),
          operation({ operationId: "" }),
        ],
      },
      { add: (async () => ({})) as never },
    )
    expect(report.skipped).toEqual(["11111111-2222-3333-4444-555555555555"])
    expect(report.failures).toEqual([
      { detail: expect.stringContaining("unparseable"), operationId: "" },
    ])
  })
})

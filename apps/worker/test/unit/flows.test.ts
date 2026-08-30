import type { OperationSnapshot } from "@geo/content-client"
import { describe, expect, it } from "vitest"

import { createOutboxProcessor } from "../../src/processors/outbox.js"
import { operationFlowOf, operationStageJobId } from "../../src/queues/flows.js"
import { reconcileNonTerminalOperations } from "../../src/reconcile/reconcile.js"

const operation = (overrides: Partial<OperationSnapshot> = {}): OperationSnapshot => ({
  attempt: 1,
  currentStage: null,
  endpoint: "/internal/operations/generate",
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

  it("builds one terminal generation job for generate operations", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "generate",
      payload: { body: {} },
      tenantId: 7,
    })
    expect(flow.name).toBe("generation")
    expect(flow.queueName).toBe("content-generation")
    expect(flow.children).toBeUndefined()
    expect(flow.opts?.jobId).toBe("op-11111111-2222-3333-4444-555555555555-generation")
  })

  it("builds one terminal publish job for publish operations", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "publish",
      payload: { body: { editionId: 12 } },
      tenantId: 7,
    })
    expect(flow.name).toBe("publish-gate")
    expect(flow.queueName).toBe("content-publish")
    expect(flow.data).toMatchObject({ payload: { body: { editionId: 12 } } })
    expect(flow.children).toBeUndefined()
  })

  it("builds a single evaluation job for evaluate operations", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "evaluate",
      payload: {},
      tenantId: 7,
    })
    expect(flow.name).toBe("evaluation")
    expect(flow.children).toBeUndefined()
  })

  it("builds a single serial rollback gate without compiler descendants", () => {
    const flow = operationFlowOf({
      operationId: "11111111-2222-3333-4444-555555555555",
      operationType: "rollback",
      payload: {},
      tenantId: 7,
    })
    expect(flow.name).toBe("rollback-gate")
    expect(flow.queueName).toBe("content-publish")
    expect(flow.children).toBeUndefined()
    expect(flow.opts?.jobId).toBe("op-11111111-2222-3333-4444-555555555555-rollback-gate")
  })
})

describe("outbox processor", () => {
  const logs: string[] = []
  const embeddingAdded: { jobId?: string; name: string; data: unknown }[] = []
  const evaluationAdded: { jobId?: string; name: string; data: unknown }[] = []
  const publishAdded: { jobId?: string; name: string; data: unknown }[] = []
  const processor = createOutboxProcessor({
    embeddingQueue: {
      add: (async (name: string, data: unknown, opts: { jobId?: string }) => {
        embeddingAdded.push({ data, jobId: opts?.jobId, name })
        return {} as never
      }) as never,
    },
    evaluationQueue: {
      add: (async (name: string, data: unknown, opts: { jobId?: string }) => {
        evaluationAdded.push({ data, jobId: opts?.jobId, name })
        return {} as never
      }) as never,
    },
    logger: (event) => logs.push(event.code),
    publishQueue: {
      add: (async (name: string, data: unknown, opts: { jobId?: string }) => {
        publishAdded.push({ data, jobId: opts?.jobId, name })
        return {} as never
      }) as never,
    },
  })

  it("enqueues one stable embedding job per draft-written event", async () => {
    const result = await processor({
      data: { aggregateId: 42, eventId: "evt-1", tenantId: 7 },
      name: "edition.draft-written",
      queueName: "outbox",
    })
    expect(result).toEqual({ action: "embedding-enqueued", editionId: 42 })
    expect(embeddingAdded).toHaveLength(1)
    expect(embeddingAdded[0]?.jobId).toBe("embed-ed-42")
    await processor({
      data: { aggregateId: 42, eventId: "evt-2", tenantId: 7 },
      name: "edition.draft-written",
      queueName: "outbox",
    })
    expect(embeddingAdded).toHaveLength(2)
    expect(embeddingAdded[1]?.jobId).toBe("embed-ed-42")
  })

  it("enqueues one stable evaluation job for an editor evaluation intent", async () => {
    const result = await processor({
      data: {
        aggregateId: 42,
        eventId: "evt-3",
        eventPayload: { thresholds: { dimensionMin: 75, overallMin: 80 } },
        operationId: "11111111-2222-3333-4444-555555555555",
        tenantId: 7,
      },
      name: "evaluation.requested",
      queueName: "outbox",
    })
    expect(result).toEqual({
      action: "evaluation-enqueued",
      editionId: 42,
      operationId: "11111111-2222-3333-4444-555555555555",
    })
    expect(evaluationAdded).toHaveLength(1)
    expect(evaluationAdded[0]).toMatchObject({
      data: {
        operationId: "11111111-2222-3333-4444-555555555555",
        payload: { body: { editionId: 42, thresholds: { dimensionMin: 75, overallMin: 80 } } },
        tenantId: 7,
      },
      jobId: "op-11111111-2222-3333-4444-555555555555-evaluation",
      name: "evaluation",
    })
  })

  it("enqueues one stable rollback gate for a publisher-approved rollback request", async () => {
    const result = await processor({
      data: {
        eventId: "evt-4",
        eventPayload: {
          body: {
            expectedCurrentManifestSha256: "a".repeat(64),
            expectedCurrentReleaseId: "release-current",
            expectedManifestSha256: "b".repeat(64),
            rollbackIntentId: "11111111-2222-4333-8444-555555555555",
            siteId: "site-7",
            targetReleaseId: "release-target",
          },
        },
        operationId: "11111111-2222-3333-4444-555555555555",
        tenantId: 7,
      },
      name: "rollback.requested",
      queueName: "outbox",
    })
    expect(result).toEqual({
      action: "rollback-enqueued",
      operationId: "11111111-2222-3333-4444-555555555555",
    })
    expect(publishAdded).toMatchObject([
      {
        data: {
          operationId: "11111111-2222-3333-4444-555555555555",
          payload: {
            body: {
              rollbackIntentId: "11111111-2222-4333-8444-555555555555",
              siteId: "site-7",
            },
          },
          tenantId: 7,
        },
        jobId: "op-11111111-2222-3333-4444-555555555555-rollback-gate",
        name: "rollback-gate",
      },
    ])
  })

  it("observes informational events without enqueueing", async () => {
    const result = await processor({
      data: { eventId: "evt-4" },
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

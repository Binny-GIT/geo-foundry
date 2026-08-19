import type { OperationSnapshot } from "@geo/content-client"
import { FlowProducer, type Job } from "bullmq"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { parseWorkerRedisOptions } from "../../src/config/redis.js"
import { enqueueOperationFlow } from "../../src/queues/flows.js"
import { reconcileNonTerminalOperations } from "../../src/reconcile/reconcile.js"
import { createWorkerRuntime } from "../../src/runtime/worker-runtime.js"

const PREFIX = `geo-foundry:t24-${Date.now()}`
const OP_ID = "11111111-2222-3333-4444-555555555555"

const snapshot = (overrides: Partial<OperationSnapshot> = {}): OperationSnapshot => ({
  attempt: 1,
  currentStage: null,
  endpoint: "/v1/generate",
  error: null,
  operationId: OP_ID,
  operationType: "generate",
  requestPayload: { body: { contentId: 12 } },
  result: null,
  state: "running",
  tenantId: 7,
  ...overrides,
})

const waitFor = async (
  probe: () => Promise<boolean>,
  timeoutMs = 30_000,
  everyMs = 200,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs))
  }
  throw new Error("waitFor timed out")
}

describe("worker flow integration (shared Redis)", () => {
  let runtime: ReturnType<typeof createWorkerRuntime>
  let producer: FlowProducer
  const execution: string[] = []
  const ledger: { completed: number; started: number } = { completed: 0, started: 0 }
  let generationAttempts = 0
  let failGeneration = false

  const clientOf = () => ({
    completeOperationStage: async (_id: string, request: { outcome: string }) => {
      if (request.outcome === "succeeded") {
        ledger.completed += 1
      }
      return snapshot()
    },
    getOperation: async (operationId: string) => snapshot({ operationId }),
    listNonTerminalOperations: async () => [snapshot()],
    startOperationStage: async () => {
      ledger.started += 1
      return snapshot()
    },
  })

  beforeAll(async () => {
    const connection = parseWorkerRedisOptions(process.env)
    const contextOf = (client: ReturnType<typeof clientOf>) => ({
      client,
      logger: () => {},
    })
    const baseClient = clientOf()
    runtime = createWorkerRuntime({
      connection,
      context: contextOf(baseClient),
      prefix: PREFIX,
      processors: {
        compile: async (job: Job) => {
          execution.push(`compile:${job.id ?? ""}`)
          return { deferred: true }
        },
        embedding: async () => ({ stored: [] }),
        evaluation: async () => ({ decision: "passed" }),
        generation: async (job: Job) => {
          execution.push(`generation:${job.id ?? ""}`)
          generationAttempts += 1
          if (failGeneration) {
            throw new Error("generation exploded")
          }
          return { outcomes: [] }
        },
        publish: async (job: Job) => {
          execution.push(`publish:${job.id ?? ""}`)
          return { deferred: true }
        },
      },
    })
    producer = new FlowProducer({ connection, prefix: PREFIX })
    await runtime.start()
  })

  afterAll(async () => {
    for (const queue of Object.values(runtime.queues)) {
      await queue.obliterate({ force: true })
    }
    await runtime.close()
    await producer.close()
  })

  it("runs children before the publish root and journals every stage", async () => {
    await enqueueOperationFlow(producer, {
      operationId: OP_ID,
      operationType: "generate",
      payload: { body: { contentId: 12 } },
    })
    const publishQueue = runtime.queues.publish
    const publishJob = await publishQueue.getJob(`op-${OP_ID}-publish-gate`)
    expect(publishJob).not.toBeNull()
    await waitFor(async () => (await publishJob?.getState()) === "completed")
    expect(execution).toEqual([
      `generation:op-${OP_ID}-generation`,
      `compile:op-${OP_ID}-compile-trigger`,
      `publish:op-${OP_ID}-publish-gate`,
    ])
  })

  it("blocks the publish gate when a child keeps failing", async () => {
    failGeneration = true
    execution.length = 0
    const blockedId = "22222222-3333-4444-5555-666666666666"
    await enqueueOperationFlow(producer, {
      operationId: blockedId,
      operationType: "generate",
      payload: { body: { contentId: 13 } },
    })
    const generationJob = await runtime.queues.generation.getJob(`op-${blockedId}-generation`)
    await waitFor(async () => (await generationJob?.getState()) === "failed")
    expect(generationAttempts).toBeGreaterThanOrEqual(3)
    const publishJob = await runtime.queues.publish.getJob(`op-${blockedId}-publish-gate`)
    const publishState = await publishJob?.getState()
    expect(publishState === "completed").toBe(false)
    expect(execution.filter((entry) => entry.startsWith("publish"))).toEqual([])
    failGeneration = false
  })

  it("retries a transient failure exactly to one completed result", async () => {
    let sideEffects = 0
    const retryRuntime = createWorkerRuntime({
      connection: parseWorkerRedisOptions(process.env),
      context: { client: clientOf(), logger: () => {} },
      prefix: `${PREFIX}-retry`,
      processors: {
        compile: async () => ({}),
        embedding: async () => ({}),
        evaluation: async () => ({}),
        generation: async () => {
          if (sideEffects === 0) {
            sideEffects += 1
            throw new Error("transient failure")
          }
          sideEffects += 1
        },
        publish: async () => ({}),
      },
    })
    await retryRuntime.start()
    const queue = retryRuntime.queues.generation
    const job = await queue.add(
      "generation",
      { operationId: OP_ID },
      {
        attempts: 3,
        backoff: 100,
        jobId: "retry-probe-1",
      },
    )
    await waitFor(async () => (await job?.getState()) === "completed", 60_000)
    expect(sideEffects).toBe(2)
    for (const eachQueue of Object.values(retryRuntime.queues)) {
      await eachQueue.obliterate({ force: true }).catch(() => {})
    }
    await retryRuntime.close()
  })

  it("restores non-terminal operations after the queue is wiped", async () => {
    await runtime.queues.generation.obliterate({ force: true })
    await runtime.queues.compile.obliterate({ force: true })
    await runtime.queues.publish.obliterate({ force: true })
    const restoredId = "33333333-4444-5555-6666-777777777777"
    const report = await reconcileNonTerminalOperations(
      {
        listNonTerminalOperations: async () => [
          snapshot({ operationId: restoredId, state: "queued" }),
        ],
      },
      producer,
    )
    expect(report.enqueued).toEqual([restoredId])
    const generationJob = await runtime.queues.generation.getJob(`op-${restoredId}-generation`)
    expect(generationJob).not.toBeNull()
    const publishJob = await runtime.queues.publish.getJob(`op-${restoredId}-publish-gate`)
    await waitFor(async () => (await publishJob?.getState()) === "completed")
  })

  it("drains in-flight jobs on close", async () => {
    const drainRuntime = createWorkerRuntime({
      connection: parseWorkerRedisOptions(process.env),
      context: {
        client: clientOf(),
        logger: () => {},
      },
      prefix: `${PREFIX}-drain`,
      processors: {
        compile: async () => ({}),
        embedding: async () => ({}),
        evaluation: async () => ({}),
        generation: async () => {
          await new Promise((resolve) => setTimeout(resolve, 600))
          execution.push("drained-generation")
          return {}
        },
        publish: async () => ({}),
      },
    })
    await drainRuntime.start()
    await drainRuntime.queues.generation.add(
      "generation",
      { operationId: "44444444-5555-6666-7777-888888888888" },
      { jobId: "drain-probe-1" },
    )
    await drainRuntime.close()
    expect(execution).toContain("drained-generation")
    for (const queue of Object.values(drainRuntime.queues)) {
      await queue.obliterate({ force: true }).catch(() => {})
    }
  })
})

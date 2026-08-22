import type { OperationSnapshot } from "@geo/content-client"
import { FlowProducer, type Job } from "bullmq"
import { createClient } from "redis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { parseWorkerRedisOptions } from "../../src/config/redis.js"
import { enqueueOperationFlow } from "../../src/queues/flows.js"
import { reconcileNonTerminalOperations } from "../../src/reconcile/reconcile.js"
import { createWorkerRuntime } from "../../src/runtime/worker-runtime.js"

const PREFIX = process.env.GEO_FOUNDRY_FAULT_REDIS_PREFIX ?? `geo-foundry:t24-${Date.now()}`
if (!/^geo-foundry:(?:t24-\d+|todo39-[a-z0-9]{12,32})$/.test(PREFIX)) {
  throw new Error("WORKER_TEST_REDIS_PREFIX_INVALID")
}
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

const deleteOwnedKeys = async (
  connection: ReturnType<typeof parseWorkerRedisOptions>,
  prefix: string,
): Promise<void> => {
  const client = createClient({
    database: connection.db,
    ...(connection.password === undefined ? {} : { password: connection.password }),
    socket: { host: connection.host, port: connection.port },
    ...(connection.username === undefined ? {} : { username: connection.username }),
  })
  await client.connect()
  try {
    const keys = []
    for await (const batch of client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) {
      keys.push(...batch)
    }
    if (keys.length > 0) {
      await client.del(keys)
    }
    const remaining = []
    for await (const batch of client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) {
      remaining.push(...batch)
    }
    expect(remaining).toEqual([])
  } finally {
    await client.quit()
  }
}

describe("worker flow integration (shared Redis)", () => {
  let connection: ReturnType<typeof parseWorkerRedisOptions>
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
    connection = parseWorkerRedisOptions(process.env)
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
    const prefixes = [PREFIX, `${PREFIX}-crash`, `${PREFIX}-drain`, `${PREFIX}-retry`]
    try {
      for (const queue of Object.values(runtime.queues)) {
        await queue.obliterate({ force: true })
      }
      for (const prefix of prefixes) {
        await deleteOwnedKeys(connection, prefix)
      }
    } finally {
      await runtime.close()
      await producer.close()
    }
  })

  it("runs one deterministic terminal generation stage per operation", async () => {
    await enqueueOperationFlow(producer, {
      operationId: OP_ID,
      operationType: "generate",
      payload: { body: { contentId: 12 } },
    })
    const generationJob = await runtime.queues.generation.getJob(`op-${OP_ID}-generation`)
    expect(generationJob).not.toBeNull()
    await waitFor(async () => (await generationJob?.getState()) === "completed")
    expect(execution).toEqual([`generation:op-${OP_ID}-generation`])
    expect(await runtime.queues.publish.getJob(`op-${OP_ID}-publish-gate`)).toBeUndefined()
  })

  it("does not enqueue another terminal stage when generation keeps failing", async () => {
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
    await waitFor(async () => (await generationJob?.getState()) === "completed")
    expect(await runtime.queues.publish.getJob(`op-${restoredId}-publish-gate`)).toBeUndefined()
  })

  it("records a Redis enqueue outage and recovers the same deterministic job", async () => {
    const recoveredId = "55555555-6666-7777-8888-999999999999"
    const outage = await reconcileNonTerminalOperations(
      {
        listNonTerminalOperations: async () => [
          snapshot({ operationId: recoveredId, state: "queued" }),
        ],
      },
      {
        add: (async () => {
          throw new Error("ECONNREFUSED simulated test adapter")
        }) as never,
      },
    )
    expect(outage.enqueued).toEqual([])
    expect(outage.failures).toEqual([
      {
        detail: expect.stringContaining("ECONNREFUSED"),
        operationId: recoveredId,
      },
    ])

    const recovered = await reconcileNonTerminalOperations(
      {
        listNonTerminalOperations: async () => [
          snapshot({ operationId: recoveredId, state: "queued" }),
        ],
      },
      producer,
    )
    expect(recovered.enqueued).toEqual([recoveredId])
    const job = await runtime.queues.generation.getJob(`op-${recoveredId}-generation`)
    await waitFor(async () => (await job?.getState()) === "completed")
  })

  it("deduplicates concurrent reconcilers to one generation side effect", async () => {
    const concurrentId = "66666666-7777-8888-9999-aaaaaaaaaaaa"
    const before = execution.filter(
      (entry) => entry === `generation:op-${concurrentId}-generation`,
    ).length
    const client = {
      listNonTerminalOperations: async () => [
        snapshot({ operationId: concurrentId, state: "queued" }),
      ],
    }
    const [first, second] = await Promise.all([
      reconcileNonTerminalOperations(client, producer),
      reconcileNonTerminalOperations(client, producer),
    ])
    expect(first.failures).toEqual([])
    expect(second.failures).toEqual([])
    const job = await runtime.queues.generation.getJob(`op-${concurrentId}-generation`)
    await waitFor(async () => (await job?.getState()) === "completed")
    const after = execution.filter(
      (entry) => entry === `generation:op-${concurrentId}-generation`,
    ).length
    expect(after - before).toBe(1)
  })

  it("recovers a locked job after its test worker is force-closed", async () => {
    const prefix = `${PREFIX}-crash`
    const crashId = "77777777-8888-9999-aaaa-bbbbbbbbbbbb"
    let notifyLocked: (() => void) | undefined
    const locked = new Promise<void>((resolve) => {
      notifyLocked = resolve
    })
    const crashRuntime = createWorkerRuntime({
      connection,
      context: { client: clientOf(), logger: () => {} },
      prefix,
      processors: {
        compile: async () => ({}),
        embedding: async () => ({}),
        evaluation: async () => ({}),
        generation: async () => {
          notifyLocked?.()
          await new Promise(() => {})
        },
        publish: async () => ({}),
      },
      recovery: { lockDurationMs: 250, maxStalledCount: 1, stalledIntervalMs: 250 },
    })
    let recoveryRuntime: ReturnType<typeof createWorkerRuntime> | undefined
    try {
      await crashRuntime.start()
      await crashRuntime.queues.generation.add(
        "generation",
        { operationId: crashId },
        { attempts: 3, jobId: `op-${crashId}-generation` },
      )
      await locked
      const generationWorker = crashRuntime.workers.find(
        (worker) => worker.name === "content-generation",
      )
      if (generationWorker === undefined) {
        throw new Error("generation worker missing")
      }
      await generationWorker.close(true)

      let recoveredSideEffects = 0
      recoveryRuntime = createWorkerRuntime({
        connection,
        context: { client: clientOf(), logger: () => {} },
        prefix,
        processors: {
          compile: async () => ({}),
          embedding: async () => ({}),
          evaluation: async () => ({}),
          generation: async () => {
            recoveredSideEffects += 1
          },
          publish: async () => ({}),
        },
        recovery: { lockDurationMs: 250, maxStalledCount: 1, stalledIntervalMs: 250 },
      })
      await recoveryRuntime.start()
      const recoveredJob = await recoveryRuntime.queues.generation.getJob(
        `op-${crashId}-generation`,
      )
      await waitFor(async () => (await recoveredJob?.getState()) === "completed")
      expect(recoveredSideEffects).toBe(1)
    } finally {
      for (const queue of Object.values(recoveryRuntime?.queues ?? crashRuntime.queues)) {
        await queue.obliterate({ force: true }).catch(() => {})
      }
      await recoveryRuntime?.close()
      await crashRuntime.close()
      await deleteOwnedKeys(connection, prefix)
    }
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

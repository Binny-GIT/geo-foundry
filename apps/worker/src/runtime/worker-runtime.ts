import { type JobsOptions, type Processor, Queue, Worker, type WorkerOptions } from "bullmq"
import type { ProcessorContext, WorkerLogger } from "../processors/types.js"
import { QUEUE_NAME, QUEUE_PREFIX, type WorkQueueName, workJobOptions } from "../queues/flows.js"
import { runForTenant } from "../config/tenant-keyring.js"

export type RuntimeQueueName = WorkQueueName | "outbox"

/** Concurrency by workload: heavy generation is narrow, triggers are serial. */
export const QUEUE_CONCURRENCY: Readonly<Record<RuntimeQueueName, number>> = {
  compile: 1,
  embedding: 4,
  evaluation: 4,
  generation: 2,
  intake: 2,
  outbox: 1,
  publish: 1,
}

export const RUNTIME_QUEUE_NAMES = Object.keys(QUEUE_CONCURRENCY) as RuntimeQueueName[]

export type WorkerRuntimeConfig = {
  readonly prefix?: string
  readonly recovery?: {
    readonly lockDurationMs?: number
    readonly maxStalledCount?: number
    readonly stalledIntervalMs?: number
  }
  readonly connection: {
    readonly db: number
    readonly host: string
    readonly password?: string
    readonly port: number
    readonly username?: string
  }
  readonly context: ProcessorContext
  readonly logger: WorkerLogger
  readonly processors: Readonly<Record<WorkQueueName, Processor>>
  /**
   * Optional because queue-only flow tests do not consume the CMS outbox. The
   * production daemon supplies this factory, which receives the shared queue
   * handles before the outbox Worker is created.
   */
  readonly outboxProcessor?: (queues: Readonly<Record<WorkQueueName, Queue>>) => Processor
}

export type WorkerRuntime = {
  readonly close: () => Promise<void>
  readonly queues: Readonly<Record<RuntimeQueueName, Queue>>
  readonly start: () => Promise<void>
  readonly workers: readonly Worker[]
}

const workQueueNames = Object.keys(QUEUE_NAME).filter(
  (queue): queue is WorkQueueName => queue !== "outbox",
)

const recoveryOptionsOf = (config: WorkerRuntimeConfig) => {
  const lockDuration = config.recovery?.lockDurationMs ?? 30_000
  const maxStalledCount = config.recovery?.maxStalledCount ?? 1
  const stalledInterval = config.recovery?.stalledIntervalMs ?? 30_000
  if (
    !Number.isInteger(lockDuration) ||
    lockDuration < 1 ||
    !Number.isInteger(maxStalledCount) ||
    maxStalledCount < 0 ||
    !Number.isInteger(stalledInterval) ||
    stalledInterval < 1
  ) {
    throw new Error("WORKER_RECOVERY_OPTIONS_INVALID")
  }
  return { lockDuration, maxStalledCount, stalledInterval }
}

export const workerOptionsOf = (
  queue: RuntimeQueueName,
  config: WorkerRuntimeConfig,
): WorkerOptions => ({
  autorun: false,
  connection: config.connection,
  concurrency: QUEUE_CONCURRENCY[queue],
  prefix: config.prefix ?? QUEUE_PREFIX,
  ...recoveryOptionsOf(config),
})

/**
 * One worker per workload queue plus lazily-created queue handles. Workers
 * start paused (autorun false) and begin consuming on run(); close() drains
 * in-flight jobs for graceful SIGTERM.
 */
export const createWorkerRuntime = (config: WorkerRuntimeConfig): WorkerRuntime => {
  const workers: Worker[] = []
  const queues = {} as Record<RuntimeQueueName, Queue>
  for (const queue of RUNTIME_QUEUE_NAMES) {
    queues[queue] = new Queue(QUEUE_NAME[queue], {
      connection: config.connection,
      prefix: config.prefix ?? QUEUE_PREFIX,
      defaultJobOptions: workJobOptions() as JobsOptions,
    })
  }
  const tenantScoped = (processor: Processor): Processor =>
    async (job, token) =>
      runForTenant(
        typeof job.data["tenantId"] === "number" && Number.isInteger(job.data["tenantId"])
          ? job.data["tenantId"]
          : undefined,
        async () => processor(job, token),
      )
  for (const queue of workQueueNames) {
    const processor = config.processors[queue]
    if (processor === undefined) {
      throw new Error(`WORKER_PROCESSOR_MISSING:${queue}`)
    }
    workers.push(new Worker(QUEUE_NAME[queue], tenantScoped(processor), workerOptionsOf(queue, config)))
  }
  if (config.outboxProcessor !== undefined) {
    workers.push(
      new Worker(
        QUEUE_NAME.outbox,
        tenantScoped(config.outboxProcessor(queues)),
        workerOptionsOf("outbox", config),
      ),
    )
  }
  return {
    close: async () => {
      await Promise.all(workers.map(async (worker) => worker.close()))
      await Promise.all(Object.values(queues).map(async (queue) => queue.close()))
    },
    queues,
    start: async () => {
      for (const worker of workers) {
        void worker.run().catch(() => {})
      }
    },
    workers,
  }
}

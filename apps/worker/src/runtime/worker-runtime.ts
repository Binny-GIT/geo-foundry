import type { ProcessorContext, WorkerLogger } from "../processors/types.js"
import { QUEUE_NAME, QUEUE_PREFIX, workJobOptions, type WorkQueueName } from "../queues/flows.js"
import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from "bullmq"

/** Concurrency by workload: heavy generation is narrow, triggers are serial. */
export const QUEUE_CONCURRENCY: Readonly<Record<WorkQueueName, number>> = {
  compile: 1,
  embedding: 4,
  evaluation: 4,
  generation: 2,
  publish: 1,
}

export type WorkerRuntimeConfig = {
  readonly prefix?: string
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
}

export type WorkerRuntime = {
  readonly close: () => Promise<void>
  readonly queues: Readonly<Record<WorkQueueName, Queue>>
  readonly start: () => Promise<void>
  readonly workers: readonly Worker[]
}

export const workerOptionsOf = (
  queue: WorkQueueName,
  config: WorkerRuntimeConfig,
): WorkerOptions => ({
  autorun: false,
  connection: config.connection,
  concurrency: QUEUE_CONCURRENCY[queue],
  prefix: config.prefix ?? QUEUE_PREFIX,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})

/**
 * One worker per workload queue plus lazily-created queue handles. Workers
 * start paused (autorun false) and begin consuming on run(); close() drains
 * in-flight jobs for graceful SIGTERM.
 */
export const createWorkerRuntime = (config: WorkerRuntimeConfig): WorkerRuntime => {
  const workers: Worker[] = []
  const queues = {} as Record<WorkQueueName, Queue>
  for (const queue of Object.keys(QUEUE_CONCURRENCY) as WorkQueueName[]) {
    queues[queue] = new Queue(QUEUE_NAME[queue], {
      connection: config.connection,
      prefix: config.prefix ?? QUEUE_PREFIX,
      defaultJobOptions: workJobOptions() as JobsOptions,
    })
    workers.push(
      new Worker(QUEUE_NAME[queue], config.processors[queue], workerOptionsOf(queue, config)),
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

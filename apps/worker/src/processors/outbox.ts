import type { Queue } from "bullmq"

import type { WorkerLogger } from "./types.js"

export type OutboxJobData = {
  readonly aggregateId?: number
  readonly eventId: string
  readonly eventPayload?: Record<string, unknown>
  readonly operationId?: string
  readonly tenantId?: number
}

export type OutboxJobLike = {
  readonly data: OutboxJobData
  readonly id?: string
  readonly name: string
  readonly queueName: string
}

export const editionEmbeddingJobId = (editionId: number): string => `embed-ed-${editionId}`

/**
 * Outbox consumer: maps transactional CMS events onto follow-up work.
 * The dispatcher adds jobs named by event type; enqueues use stable jobIds
 * so duplicate dispatch (the dispatcher's at-least-once guarantee) is
 * de-duplicated by BullMQ. The processor never mutates CMS state directly.
 */
export const createOutboxProcessor = (options: {
  readonly embeddingQueue: Pick<Queue, "add">
  readonly logger: WorkerLogger
}) => {
  const { embeddingQueue, logger } = options
  return async (job: OutboxJobLike): Promise<Record<string, unknown>> => {
    const log = (code: string, detail?: Record<string, unknown>) =>
      logger({
        code,
        ...(detail === undefined ? {} : { detail }),
        jobId: job.id ?? null,
        queue: job.queueName,
      })
    const editionId = job.data.aggregateId
    if (job.name === "edition.draft-written" && Number.isInteger(editionId)) {
      if (!Number.isInteger(job.data.tenantId) || (job.data.tenantId ?? 0) <= 0) {
        throw new Error("WORKER_OUTBOX_TENANT_REQUIRED")
      }
      await embeddingQueue.add(
        "embedding",
        {
          operationId: `edition-${editionId}`,
          payload: { editionId },
          ...(job.data.tenantId === undefined ? {} : { tenantId: job.data.tenantId }),
        },
        {
          attempts: 3,
          backoff: { delay: 2000, type: "exponential" },
          jobId: editionEmbeddingJobId(Number(editionId)),
        },
      )
      log("worker.outbox.embedding-enqueued", { editionId })
      return { action: "embedding-enqueued", editionId }
    }
    if (job.name === "publish.requested" || job.name === "edition.compile-recorded") {
      log("worker.outbox.trigger-observed", { type: job.name })
      return { action: "trigger-observed", type: job.name }
    }
    log("worker.outbox.event-observed", { type: job.name })
    return { action: "observed", type: job.name }
  }
}

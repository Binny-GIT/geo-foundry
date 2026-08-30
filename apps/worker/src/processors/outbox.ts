import type { Queue } from "bullmq"

import { operationStageJobId, workJobOptions } from "../queues/flows.js"
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

const evaluationThresholdsOf = (
  payload: Record<string, unknown> | undefined,
): { readonly dimensionMin: number; readonly overallMin: number } | undefined => {
  const thresholds = payload?.["thresholds"]
  if (thresholds === undefined) return undefined
  if (typeof thresholds !== "object" || thresholds === null) {
    throw new Error("WORKER_OUTBOX_EVALUATION_THRESHOLDS_INVALID")
  }
  const row = thresholds as Record<string, unknown>
  if (
    typeof row["dimensionMin"] !== "number" ||
    row["dimensionMin"] < 0 ||
    row["dimensionMin"] > 100 ||
    typeof row["overallMin"] !== "number" ||
    row["overallMin"] < 0 ||
    row["overallMin"] > 100
  ) {
    throw new Error("WORKER_OUTBOX_EVALUATION_THRESHOLDS_INVALID")
  }
  return { dimensionMin: row["dimensionMin"], overallMin: row["overallMin"] }
}

/**
 * Outbox consumer: maps transactional CMS events onto follow-up work.
 * The dispatcher adds jobs named by event type; enqueues use stable jobIds
 * so duplicate dispatch (the dispatcher's at-least-once guarantee) is
 * de-duplicated by BullMQ. The processor never mutates CMS state directly.
 */
export const createOutboxProcessor = (options: {
  readonly embeddingQueue: Pick<Queue, "add">
  readonly evaluationQueue: Pick<Queue, "add">
  readonly publishQueue: Pick<Queue, "add">
  readonly logger: WorkerLogger
}) => {
  const { embeddingQueue, evaluationQueue, publishQueue, logger } = options
  return async (job: OutboxJobLike): Promise<Record<string, unknown>> => {
    const log = (code: string, detail?: Record<string, unknown>) =>
      logger({
        code,
        ...(detail === undefined ? {} : { detail }),
        jobId: job.id ?? null,
        queue: job.queueName,
      })
    const editionId = job.data.aggregateId
    if (job.name === "evaluation.requested") {
      if (
        !Number.isInteger(editionId) ||
        !Number.isInteger(job.data.tenantId) ||
        (job.data.tenantId ?? 0) <= 0 ||
        typeof job.data.operationId !== "string" ||
        job.data.operationId.length === 0
      ) {
        throw new Error("WORKER_OUTBOX_EVALUATION_INPUT_INVALID")
      }
      const thresholds = evaluationThresholdsOf(job.data.eventPayload)
      await evaluationQueue.add(
        "evaluation",
        {
          operationId: job.data.operationId,
          payload: { body: { editionId, ...(thresholds === undefined ? {} : { thresholds }) } },
          tenantId: job.data.tenantId,
        },
        {
          ...workJobOptions(),
          jobId: operationStageJobId(job.data.operationId, "evaluation"),
        },
      )
      log("worker.outbox.evaluation-enqueued", { editionId, operationId: job.data.operationId })
      return { action: "evaluation-enqueued", editionId, operationId: job.data.operationId }
    }
    if (job.name === "rollback.requested") {
      if (
        !Number.isInteger(job.data.tenantId) ||
        (job.data.tenantId ?? 0) <= 0 ||
        typeof job.data.operationId !== "string" ||
        job.data.operationId.length === 0 ||
        typeof job.data.eventPayload !== "object" ||
        job.data.eventPayload === null
      ) {
        throw new Error("WORKER_OUTBOX_ROLLBACK_INPUT_INVALID")
      }
      await publishQueue.add(
        "rollback-gate",
        {
          operationId: job.data.operationId,
          payload: job.data.eventPayload,
          tenantId: job.data.tenantId,
        },
        {
          ...workJobOptions(),
          jobId: operationStageJobId(job.data.operationId, "rollback-gate"),
        },
      )
      log("worker.outbox.rollback-enqueued", { operationId: job.data.operationId })
      return { action: "rollback-enqueued", operationId: job.data.operationId }
    }
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

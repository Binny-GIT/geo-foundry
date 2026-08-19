import type { Job } from "bullmq"

import {
  TerminalJobError,
  type ProcessorContext,
  type ProcessorOutcome,
  type WorkJobData,
} from "./types.js"

export type OperationProcessorSpec = {
  /** Ledger stage name journaled via start/completeOperationStage. */
  readonly stage: string
  readonly work: (context: ProcessorContext, job: Job<WorkJobData>) => Promise<ProcessorOutcome>
}

export type ProcessorDeps = {
  readonly context: ProcessorContext
}

/**
 * Wraps one unit of operation work with the ledger stage journey:
 * start -> work -> complete(succeeded|failed). Unknown errors propagate so
 * BullMQ retries with backoff; TerminalJobError completes the operation as
 * failed without a retry (poison-job protection - one logical result).
 */
export const operationProcessor =
  (deps: ProcessorDeps, spec: OperationProcessorSpec) =>
  async (job: Job<WorkJobData>): Promise<ProcessorOutcome> => {
    const { context } = deps
    const operation = await context.client.getOperation(job.data.operationId)
    context.logger({
      code: "worker.job.started",
      detail: { attempt: operation.attempt, stage: spec.stage },
      jobId: job.id ?? null,
      queue: job.queueName,
    })
    await context.client.startOperationStage(operation.operationId, {
      attempt: operation.attempt,
      stage: spec.stage,
    })
    try {
      const outcome = await spec.work(context, job)
      await context.client.completeOperationStage(operation.operationId, {
        attempt: operation.attempt,
        outcome: "succeeded",
        result:
          outcome.kind === "succeeded"
            ? outcome.result
            : { deferred: outcome.kind === "deferred", reason: outcome.reason },
        stage: spec.stage,
      })
      context.logger({
        code: `worker.job.${outcome.kind}`,
        jobId: job.id ?? null,
        queue: job.queueName,
      })
      return outcome
    } catch (error) {
      if (error instanceof TerminalJobError) {
        await context.client.completeOperationStage(operation.operationId, {
          attempt: operation.attempt,
          error: { code: error.code, message: error.message },
          outcome: "failed",
          stage: spec.stage,
        })
        context.logger({
          code: "worker.job.terminal-failure",
          detail: { code: error.code },
          jobId: job.id ?? null,
          queue: job.queueName,
        })
        return { kind: "failed", reason: error.code }
      }
      context.logger({
        code: "worker.job.retryable-failure",
        detail: { message: String(error).slice(0, 200) },
        jobId: job.id ?? null,
        queue: job.queueName,
      })
      throw error
    }
  }

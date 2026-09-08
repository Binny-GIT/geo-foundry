import {
  TerminalJobError,
  type ProcessorContext,
  type ProcessorOutcome,
  type WorkJob,
  type WorkJobData,
} from "./types.js"

export type OperationProcessorSpec = {
  /** Ledger stage name journaled via start/completeOperationStage. */
  readonly stage: string
  readonly work: (context: ProcessorContext, job: WorkJob<WorkJobData>) => Promise<ProcessorOutcome>
}

export type ProcessorDeps = {
  readonly context: ProcessorContext
}

/** 与旧 BullMQ attempts:3 + 指数退避等价的进程内重试；队列本身不再重试。 */
const MAX_ATTEMPTS = 3
const backoffMsOf = (attempt: number): number => 2_000 * 2 ** (attempt - 1)

/**
 * Wraps one unit of operation work with the ledger stage journey:
 * start -> work -> complete(succeeded|failed). TerminalJobError completes the
 * operation as failed without a retry (poison-job protection); transient
 * errors are retried in-process and the final failure is journaled as
 * WORKER_RETRY_EXHAUSTED, so the operation always reaches a terminal state.
 */
export const operationProcessor =
  (deps: ProcessorDeps, spec: OperationProcessorSpec) =>
  async (job: WorkJob<WorkJobData>): Promise<ProcessorOutcome> => {
    const { context } = deps
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const operation = await context.client.getOperation(job.data.operationId)
      context.logger({
        code: "worker.job.started",
        detail: { attempt, stage: spec.stage },
        jobId: job.id,
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
          jobId: job.id,
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
            jobId: job.id,
            queue: job.queueName,
          })
          return { kind: "failed", reason: error.code }
        }
        const message = String(error instanceof Error ? error.message : error).slice(0, 500)
        if (attempt === MAX_ATTEMPTS) {
          await context.client.completeOperationStage(operation.operationId, {
            attempt: operation.attempt,
            error: { code: "WORKER_RETRY_EXHAUSTED", message },
            outcome: "failed",
            stage: spec.stage,
          })
          context.logger({
            code: "worker.job.retry-exhausted",
            detail: { message },
            jobId: job.id,
            queue: job.queueName,
          })
          return { kind: "failed", reason: "WORKER_RETRY_EXHAUSTED" }
        }
        context.logger({
          code: "worker.job.retryable-failure",
          detail: { attempt, message: String(error instanceof Error ? error.message : error).slice(0, 200) },
          jobId: job.id,
          queue: job.queueName,
        })
        await new Promise((resolve) => setTimeout(resolve, backoffMsOf(attempt)))
      }
    }
    return { kind: "failed", reason: "WORKER_RETRY_EXHAUSTED" }
  }

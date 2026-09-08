import type { ContentServiceClient, OperationSnapshot } from "@geo/content-client"

export type WorkerLogEvent = {
  readonly code: string
  readonly detail?: Record<string, unknown>
  readonly jobId: string | null
  readonly queue: string
}

export type WorkerLogger = (event: WorkerLogEvent) => void

export type ProcessorContext = {
  readonly client: Pick<
    ContentServiceClient,
    | "completeOperationStage"
    | "consumeRollbackIntent"
    | "findSimilarEditions"
    | "getCompileSnapshot"
    | "getEditionInput"
    | "getOperation"
    | "recordAssessment"
    | "recordCompileResult"
    | "recordPublishedRelease"
    | "recordRollbackReceipt"
    | "startOperationStage"
    | "storeEmbedding"
    | "writeDraftVersion"
  >
  readonly logger: WorkerLogger
}

export type ProcessorOutcome =
  | { readonly kind: "deferred"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "succeeded"; readonly result: Record<string, unknown> }

/**
 * 队列任务的最小形状（pg-boss work handler 适配层构造）：
 * name 是阶段名（evaluation/publish-gate/...），queueName 是队列名，
 * 与旧 BullMQ Job 的业务语义一一对应。
 */
export type WorkJob<TData = WorkJobData> = {
  readonly data: TData
  readonly id: string
  readonly name: string
  readonly queueName: string
}

export type WorkJobData = {
  readonly operationId: string
  readonly payload?: Record<string, unknown>
  readonly tenantId?: number
}

/** Terminal processor failure: never retried, recorded on the ledger. */
export class TerminalJobError extends Error {
  override readonly name = "TerminalJobError"

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const snapshotOf = (
  operation: OperationSnapshot,
): { attempt: number; requestPayload: Record<string, unknown> } => ({
  attempt: operation.attempt,
  requestPayload:
    operation.result === null || operation.result === undefined
      ? {}
      : (operation.result as Record<string, unknown>),
})

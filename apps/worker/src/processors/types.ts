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
    | "findSimilarEditions"
    | "getEditionInput"
    | "getOperation"
    | "recordAssessment"
    | "startOperationStage"
    | "storeEmbedding"
    | "submitOperation"
    | "writeDraftVersion"
  >
  readonly logger: WorkerLogger
}

export type ProcessorOutcome =
  | { readonly kind: "deferred"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "succeeded"; readonly result: Record<string, unknown> }

export type WorkJobData = {
  readonly operationId: string
  readonly payload?: Record<string, unknown>
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

import type { ContentServiceClient, OperationSnapshot } from "@geo/content-client"

import type { FlowProducer } from "bullmq"
import {
  enqueueOperationFlow,
  OperationFlowError,
  type OperationFlowInput,
} from "../queues/flows.js"

export type ReconcileReport = {
  readonly enqueued: readonly string[]
  readonly failures: readonly { readonly detail: string; readonly operationId: string }[]
  readonly skipped: readonly string[]
}

const flowTypeOf = (operation: OperationSnapshot): OperationFlowInput["operationType"] => {
  switch (operation.operationType) {
    case "evaluate":
    case "generate":
    case "publish":
    case "rollback":
      return operation.operationType
    default:
      throw new OperationFlowError(`unsupported operation type ${String(operation.operationType)}`)
  }
}

/**
 * Reconciliation after Redis loss (or at worker boot): the CMS ledger is the
 * source of truth, never the queue. Every non-terminal operation is re-fed
 * into its deterministic flow; BullMQ de-duplicates jobIds so already-queued
 * work is skipped, and terminal operations are left alone.
 */
export const reconcileNonTerminalOperations = async (
  client: Pick<ContentServiceClient, "listNonTerminalOperations">,
  producer: FlowProducer,
): Promise<ReconcileReport> => {
  const operations = await client.listNonTerminalOperations()
  const enqueued: string[] = []
  const skipped: string[] = []
  const failures: { detail: string; operationId: string }[] = []
  for (const operation of operations) {
    if (
      operation.state === "succeeded" ||
      operation.state === "failed" ||
      operation.state === "cancelled"
    ) {
      skipped.push(operation.operationId)
      continue
    }
    try {
      await enqueueOperationFlow(producer, {
        operationId: operation.operationId,
        operationType: flowTypeOf(operation),
        payload: { body: (operation.requestPayload["body"] ?? {}) as Record<string, unknown> },
        tenantId: operation.tenantId,
      })
      enqueued.push(operation.operationId)
    } catch (error) {
      failures.push({
        detail: String(error instanceof Error ? error.message : error).slice(0, 200),
        operationId: operation.operationId,
      })
    }
  }
  return { enqueued, failures, skipped }
}

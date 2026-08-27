import type { ContentServiceClient } from "@geo/content-client"
import type { FlowProducer } from "bullmq"

import { enqueueOperationFlow, QUEUE_NAME, type OperationFlowInput } from "./queues/flows.js"
import type { WorkerLogger } from "./processors/types.js"

const flowTypeOf = (
  operationType: Awaited<ReturnType<ContentServiceClient["getOperation"]>>["operationType"],
): OperationFlowInput["operationType"] => {
  switch (operationType) {
    case "evaluate":
    case "generate":
    case "publish":
    case "rollback":
      return operationType
    default:
      throw new Error(`WORKER_PUBLICATION_PLAN_OPERATION_TYPE_INVALID:${String(operationType)}`)
  }
}

/** Dispatches CMS-claimed publication plans into the existing deterministic operation flow. */
export const dispatchDuePublicationPlansToQueue = async (
  input: {
    readonly client: Pick<ContentServiceClient, "dispatchDuePublicationPlans" | "getOperation">
    readonly logger: WorkerLogger
    readonly now: string
    readonly producer: FlowProducer
    readonly workerId: string
  },
): Promise<readonly { operationId: string; planId: string }[]> => {
  const plans = await input.client.dispatchDuePublicationPlans({
    now: input.now,
    workerId: input.workerId,
  })
  for (const plan of plans) {
    const operation = await input.client.getOperation(plan.operationId)
    await enqueueOperationFlow(input.producer, {
      operationId: operation.operationId,
      operationType: flowTypeOf(operation.operationType),
      payload: { body: (operation.requestPayload["body"] ?? {}) as Record<string, unknown> },
      tenantId: operation.tenantId,
    })
  }
  if (plans.length > 0) {
    input.logger({
      code: "worker.publication-plans.dispatched",
      detail: { count: plans.length },
      jobId: null,
      queue: QUEUE_NAME.publish,
    })
  }
  return plans
}

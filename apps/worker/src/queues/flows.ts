import { operationJobIdOf, parseOperationId } from "@geo/domain"
import type { FlowJob, FlowJobNode, FlowProducer, JobsOptions } from "bullmq"

/** Queue namespace shared with the CMS outbox dispatcher. */
export const QUEUE_PREFIX = "geo-foundry"

export type WorkQueueName = "compile" | "embedding" | "evaluation" | "generation" | "publish"

export const QUEUE_NAME: Readonly<Record<WorkQueueName | "outbox", string>> = {
  compile: "content-compile",
  embedding: "content-embedding",
  evaluation: "content-evaluation",
  generation: "content-generation",
  outbox: "outbox",
  publish: "content-publish",
}

const JOB_ATTEMPTS = 3
const BACKOFF = { delay: 2000, type: "exponential" as const }

export const workJobOptions = (): JobsOptions => ({
  attempts: JOB_ATTEMPTS,
  backoff: BACKOFF,
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 86_400 },
})

export class OperationFlowError extends Error {
  override readonly name = "OperationFlowError"
}

export type OperationFlowInput = {
  readonly operationId: string
  readonly operationType: "evaluate" | "generate" | "publish" | "rollback"
  readonly payload: Record<string, unknown>
}

/**
 * Deterministic jobId for one operation stage; identical re-enqueues are
 * de-duplicated by BullMQ, so crash recovery can safely repeat them.
 */
export const operationStageJobId = (operationId: string, stage: string): string => {
  const parsed = parseOperationId(operationId)
  if (!parsed.ok) {
    throw new OperationFlowError(`unparseable operation id ${operationId}`)
  }
  return operationJobIdOf(parsed.value, stage)
}

const stageJob = (
  queue: string,
  operationId: string,
  stage: string,
  payload: Record<string, unknown>,
): FlowJob => ({
  name: stage,
  data: { operationId, ...payload },
  opts: { ...workJobOptions(), jobId: operationStageJobId(operationId, stage) },
  queueName: queue,
})

/**
 * Staged flow per operation type. Children run before parents in BullMQ, so
 * the root publish gate runs last and any failed child (generation or
 * evaluation) marks the publish gate failed - publication can never observe
 * an incomplete pipeline.
 *
 * generate: publish-gate <- compile-trigger <- generation
 * evaluate: evaluation only (its aggregate gates approval downstream)
 */
export const operationFlowOf = (input: OperationFlowInput): FlowJob => {
  const payload = { payload: input.payload }
  if (input.operationType === "evaluate") {
    return stageJob(QUEUE_NAME.evaluation, input.operationId, "evaluation", payload)
  }
  if (input.operationType === "generate" || input.operationType === "publish") {
    const leaf = stageJob(
      QUEUE_NAME.generation,
      input.operationId,
      input.operationType === "generate" ? "generation" : "publish-replay",
      payload,
    )
    const compile: FlowJob = {
      ...stageJob(QUEUE_NAME.compile, input.operationId, "compile-trigger", payload),
      children: [leaf] as FlowJobNode[],
    }
    return {
      ...stageJob(QUEUE_NAME.publish, input.operationId, "publish-gate", {
        operationType: input.operationType,
        ...payload,
      }),
      children: [compile] as FlowJobNode[],
    }
  }
  throw new OperationFlowError(`unsupported operation type ${input.operationType}`)
}

export const enqueueOperationFlow = async (
  producer: FlowProducer,
  input: OperationFlowInput,
): Promise<string> => {
  const flow = operationFlowOf(input)
  await producer.add(flow)
  return String(flow.opts?.jobId ?? "")
}

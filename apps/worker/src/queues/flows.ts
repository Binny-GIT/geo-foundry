import { DEFAULT_QUEUE_PREFIX, operationJobIdOf, parseOperationId } from "@geo/domain"
import type { FlowJob, FlowProducer, JobsOptions } from "bullmq"

/** Queue namespace shared with the CMS outbox dispatcher. */
export const QUEUE_PREFIX = DEFAULT_QUEUE_PREFIX

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
 * Each ledger operation has exactly one terminal worker stage. Editorial
 * approval is an explicit reviewer action between evaluation and publication;
 * publication alone performs compile plus publish under its publisher actor.
 */
export const operationFlowOf = (input: OperationFlowInput): FlowJob => {
  const payload = { payload: input.payload }
  switch (input.operationType) {
    case "evaluate":
      return stageJob(QUEUE_NAME.evaluation, input.operationId, "evaluation", payload)
    case "generate":
      return stageJob(QUEUE_NAME.generation, input.operationId, "generation", payload)
    case "publish":
      return stageJob(QUEUE_NAME.publish, input.operationId, "publish-gate", payload)
    case "rollback":
      return stageJob(QUEUE_NAME.publish, input.operationId, "rollback-gate", payload)
    default:
      throw new OperationFlowError(`unsupported operation type ${input.operationType}`)
  }
}

export const enqueueOperationFlow = async (
  producer: FlowProducer,
  input: OperationFlowInput,
): Promise<string> => {
  const flow = operationFlowOf(input)
  await producer.add(flow)
  return String(flow.opts?.jobId ?? "")
}

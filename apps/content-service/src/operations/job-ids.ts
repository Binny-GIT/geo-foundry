import { operationJobIdOf, parseOperationId } from "@geo/domain"

export { operationJobIdOf }

export class RecoveryPlanError extends Error {
  override readonly name = "RecoveryPlanError"
}

/**
 * Recovery plan entry: after a Redis loss the queue is rebuilt from the CMS
 * ledger, never the other way around. Each non-terminal operation yields
 * deterministic jobIds for its current (or initial) stage.
 */
export type RecoveryJobPlan = {
  readonly jobId: string
  readonly operationId: string
  readonly stage: string
}

const INITIAL_STAGE = "pipeline"

export const recoveryJobPlanOf = (
  operations: readonly { readonly currentStage: string | null; readonly operationId: string }[],
): readonly RecoveryJobPlan[] =>
  operations.map((operation) => {
    const parsed = parseOperationId(operation.operationId)
    if (!parsed.ok) {
      throw new RecoveryPlanError(`unparseable operation id ${operation.operationId}`)
    }
    const stage = operation.currentStage ?? INITIAL_STAGE
    return {
      jobId: operationJobIdOf(parsed.value, stage),
      operationId: operation.operationId,
      stage,
    }
  })

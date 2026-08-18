import {
  auditRecord,
  freezeAuditTrail,
  type AuditRecord,
  type TransitionContext,
} from "../audit.js"
import type { Sha256Hash } from "../determinism.js"
import {
  DOMAIN_ERROR_CODE,
  InvalidTransitionError,
  StaleAggregateStateError,
  TransitionGuardError,
} from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { OperationId } from "../ids.js"
import { freezeOwnership, type Ownership } from "../ownership.js"
import { err, ok, type DomainResult } from "../result.js"

export const OPERATION_STATE = {
  CANCELLED: "cancelled",
  FAILED: "failed",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
} as const

export type OperationState = (typeof OPERATION_STATE)[keyof typeof OPERATION_STATE]

export type Operation = {
  readonly attempt: number
  readonly audit: readonly AuditRecord[]
  readonly id: OperationId
  readonly idempotencyKeyHash: Sha256Hash
  readonly ownership: Ownership
  readonly revision: number
  readonly retryOf: OperationId | null
  readonly state: OperationState
}

function isAllowedTransition(from: OperationState, to: OperationState): boolean {
  switch (from) {
    case "queued":
      switch (to) {
        case "running":
          return true
        case "cancelled":
        case "failed":
        case "queued":
        case "succeeded":
          return false
        default:
          return assertNever(to)
      }
    case "running":
      switch (to) {
        case "cancelled":
        case "failed":
        case "succeeded":
          return true
        case "queued":
        case "running":
          return false
        default:
          return assertNever(to)
      }
    case "cancelled":
    case "failed":
    case "succeeded":
      return false
    default:
      return assertNever(from)
  }
}

export function createOperationRetry(
  operation: Operation,
  id: OperationId,
  context: TransitionContext,
): DomainResult<Operation> {
  if (operation.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, operation.revision))
  }
  if (operation.state !== "failed") {
    return err(
      new TransitionGuardError(
        DOMAIN_ERROR_CODE.OPERATION_RETRY_SOURCE_NOT_FAILED,
        "Only failed operations can be retried",
      ),
    )
  }
  return ok(
    Object.freeze({
      attempt: operation.attempt + 1,
      audit: freezeAuditTrail([auditRecord("operation.retry.created", context)]),
      id,
      idempotencyKeyHash: operation.idempotencyKeyHash,
      ownership: freezeOwnership(operation.ownership),
      retryOf: operation.id,
      revision: 0,
      state: "queued",
    }),
  )
}

export function transitionOperation(
  operation: Operation,
  target: OperationState,
  context: TransitionContext,
): DomainResult<Operation> {
  if (operation.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, operation.revision))
  }
  if (!isAllowedTransition(operation.state, target)) {
    return err(
      new InvalidTransitionError(
        DOMAIN_ERROR_CODE.OPERATION_TRANSITION_NOT_ALLOWED,
        operation.state,
        target,
      ),
    )
  }
  return ok(
    Object.freeze({
      ...operation,
      audit: freezeAuditTrail([
        ...operation.audit,
        auditRecord(`operation.${operation.state}.${target}`, context),
      ]),
      ownership: freezeOwnership(operation.ownership),
      revision: operation.revision + 1,
      state: target,
    }),
  )
}

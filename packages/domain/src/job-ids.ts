import type { OperationId } from "./ids.js"

const STAGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Stable BullMQ jobId for one operation stage. BullMQ forbids ':' in custom
 * job ids, so the derivation uses hyphens; the result is deterministic so a
 * dispatcher crash or Redis loss can safely re-enqueue the same stage and
 * BullMQ de-duplicates it.
 */
export const operationJobIdOf = (operationId: OperationId, stage: string): string => {
  if (!STAGE_PATTERN.test(stage)) {
    throw new TypeError(`operation stage must match ${STAGE_PATTERN}: ${stage}`)
  }
  return `op-${operationId.value}-${stage}`
}

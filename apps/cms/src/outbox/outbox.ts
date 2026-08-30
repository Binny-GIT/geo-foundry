import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from "payload"

/**
 * Transactional outbox primitives.
 *
 * Every workflow mutation appends its outbox row through `appendOutboxEvent`
 * with the SAME transaction scope as the business change, so the event and
 * the change commit or roll back atomically. A row is only ever visible to
 * the dispatcher once the transaction commits, which makes "workflow change
 * without event" and "event without change" both impossible.
 */
export const OUTBOX_EVENT = {
  EDITION_TRANSITIONED: "edition.transitioned",
  EDITION_DRAFT_WRITTEN: "edition.draft-written",
  ASSESSMENT_RECORDED: "assessment.recorded",
  EDITION_COMPILE_RECORDED: "edition.compile-recorded",
  EVALUATION_REQUESTED: "evaluation.requested",
  PUBLISH_REQUESTED: "publish.requested",
  ROLLBACK_REQUESTED: "rollback.requested",
} as const

export type OutboxEventType = (typeof OUTBOX_EVENT)[keyof typeof OUTBOX_EVENT]

export type TransactionScope =
  | { readonly transactionID: NonNullable<PayloadRequest["transactionID"]> }
  | Record<string, never>

export const txOf = (req: PayloadRequest): TransactionScope => {
  const transactionID = req.transactionID
  return transactionID === undefined ? {} : { transactionID }
}

export type OutboxEventInput = {
  readonly aggregateId: number
  readonly aggregateType?: "edition" | "site"
  readonly eventPayload: Record<string, unknown>
  readonly tenantId: number
  readonly type: OutboxEventType
  readonly operationId?: string
  readonly requestId?: string
}

const outboxDataOf = (input: OutboxEventInput, eventId: string) => ({
  aggregateId: input.aggregateId,
  aggregateType: input.aggregateType ?? "edition",
  attempts: 0,
  eventPayload: input.eventPayload,
  eventId,
  lastError: null,
  operationId: input.operationId ?? null,
  requestId: input.requestId ?? null,
  status: "pending" as const,
  tenant: input.tenantId,
  type: input.type,
})

/** Append one outbox row inside the caller's transaction scope. */
export const appendOutboxEvent = async (
  payload: Payload,
  input: OutboxEventInput,
  req: TransactionScope,
): Promise<string> => {
  const eventId = crypto.randomUUID()
  await payload.create({
    collection: "outbox-events",
    data: outboxDataOf(input, eventId),
    overrideAccess: true,
    depth: 0,
    req,
  })
  return eventId
}

/**
 * Run a unit of work inside one database transaction and hand the caller a
 * transaction-scoped `req` so every read/write joins the same transaction.
 */
export const runOutboxScopedTransaction = async <T>(
  payload: Payload,
  operation: (req: TransactionScope) => Promise<T>,
): Promise<T> => {
  const req = await createLocalReq({}, payload)
  const ownsTransaction = await initTransaction(req)
  try {
    const result = await operation(txOf(req))
    if (ownsTransaction) {
      await commitTransaction(req)
    }
    return result
  } catch (error) {
    if (ownsTransaction) {
      await killTransaction(req)
    }
    throw error
  }
}

import type { PayloadRequest } from "payload"

import {
  OperationsLedgerError,
  cancelOperation,
  completeOperationStage,
  getOperation,
  listNonTerminalOperations,
  startOperationStage,
  submitOperation,
} from "../../services/operations-ledger"
import {
  cancelOperationBodySchema,
  completeOperationStageBodySchema,
  startOperationStageBodySchema,
  submitOperationBodySchema,
  type CancelOperationBody,
  type CompleteOperationStageBody,
  type StartOperationStageBody,
  type SubmitOperationBody,
} from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const publicOperationIdOf = (req: PayloadRequest): string => {
  const raw = req.routeParams?.["operationId"]
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) {
    throw new OperationsLedgerError("OPERATIONS_INPUT_INVALID", `route operationId ${String(raw)}`)
  }
  return raw
}

const handleSubmitOperation = withInternalGuards(
  { bodySchema: submitOperationBodySchema, operation: "submitOperation" },
  async (req, ctx, body: SubmitOperationBody) => {
    const outcome = await submitOperation(req.payload, {
      endpoint: body.endpoint,
      idempotencyKey: body.idempotencyKey,
      operationType: body.operationType,
      requestPayload: body.requestPayload,
      ...(body.siteId === undefined ? {} : { siteId: body.siteId }),
      ...(body.targetIds === undefined ? {} : { targetIds: body.targetIds }),
      user: req.user,
    })
    return internalJsonResponse(
      outcome.created ? 202 : 200,
      { created: outcome.created, operation: outcome.operation },
      ctx.requestId,
      null,
    )
  },
)

const handleGetOperation = withInternalGuards(
  { bodySchema: null, operation: "getOperation" },
  async (req, ctx) => {
    const operation = await getOperation(req.payload, publicOperationIdOf(req), req.user)
    return internalJsonResponse(200, { operation }, ctx.requestId, null)
  },
)

const handleStartStage = withInternalGuards(
  { bodySchema: startOperationStageBodySchema, operation: "startOperationStage" },
  async (req, ctx, body: StartOperationStageBody) => {
    const operation = await startOperationStage(req.payload, {
      attempt: body.attempt,
      operationId: publicOperationIdOf(req),
      stage: body.stage,
      user: req.user,
    })
    return internalJsonResponse(200, { operation }, ctx.requestId, null)
  },
)

const handleCompleteStage = withInternalGuards(
  { bodySchema: completeOperationStageBodySchema, operation: "completeOperationStage" },
  async (req, ctx, body: CompleteOperationStageBody) => {
    const operation = await completeOperationStage(req.payload, {
      attempt: body.attempt,
      operationId: publicOperationIdOf(req),
      outcome: body.outcome,
      ...(body.error === undefined ? {} : { error: body.error }),
      ...(body.result === undefined ? {} : { result: body.result }),
      stage: body.stage,
      user: req.user,
    })
    return internalJsonResponse(200, { operation }, ctx.requestId, null)
  },
)

const handleCancelOperation = withInternalGuards(
  { bodySchema: cancelOperationBodySchema, operation: "cancelOperation" },
  async (req, ctx, body: CancelOperationBody) => {
    const operation = await cancelOperation(req.payload, {
      operationId: publicOperationIdOf(req),
      reason: body.reason,
      user: req.user,
    })
    return internalJsonResponse(200, { operation }, ctx.requestId, null)
  },
)

const handleListNonTerminal = withInternalGuards(
  { bodySchema: null, operation: "listNonTerminalOperations" },
  async (req, ctx) => {
    const result = await listNonTerminalOperations(req.payload, req.user)
    return internalJsonResponse(200, result, ctx.requestId, null)
  },
)

export const operationHandlerByOperation: Record<string, typeof handleGetOperation> = {
  cancelOperation: handleCancelOperation,
  completeOperationStage: handleCompleteStage,
  getOperation: handleGetOperation,
  listNonTerminalOperations: handleListNonTerminal,
  startOperationStage: handleStartStage,
  submitOperation: handleSubmitOperation,
}

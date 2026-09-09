import {
  completeOperationStage,
  getOperation,
  startOperationStage,
} from "../../server/repositories/operations-ledger"
import { serverRuntime } from "../../server/runtime"
import { OperationsLedgerError } from "../../services/operations-ledger"
import {
  type CompleteOperationStageBody,
  completeOperationStageBodySchema,
  type StartOperationStageBody,
  startOperationStageBodySchema,
} from "./contracts"
import { type InternalRequest, internalJsonResponse, withInternalGuards } from "./guards"

const publicOperationIdOf = (req: InternalRequest): string => {
  const raw = req.routeParams["operationId"]
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) {
    throw new OperationsLedgerError("OPERATIONS_INPUT_INVALID", `route operationId ${String(raw)}`)
  }
  return raw
}

const handleGetOperation = withInternalGuards(
  { bodySchema: null, operation: "getOperation" },
  async (req, ctx) => {
    const operation = await getOperation(serverRuntime().db, publicOperationIdOf(req), req.user)
    return internalJsonResponse(200, { operation }, ctx.requestId, null)
  },
)

const handleStartStage = withInternalGuards(
  { bodySchema: startOperationStageBodySchema, operation: "startOperationStage" },
  async (req, ctx, body: StartOperationStageBody) => {
    const operation = await startOperationStage(serverRuntime().db, {
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
    const operation = await completeOperationStage(serverRuntime().db, {
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

export const operationHandlerByOperation: Record<string, typeof handleGetOperation> = {
  completeOperationStage: handleCompleteStage,
  getOperation: handleGetOperation,
  startOperationStage: handleStartStage,
}

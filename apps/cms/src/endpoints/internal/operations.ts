import type { PayloadRequest } from "payload"

import {
  OperationsLedgerError,
  cancelOperation,
  completeOperationStage,
  getOperation,
  listNonTerminalOperations,
  operationRequestHashOf,
  startOperationStage,
  submitOperation,
  type OperationType,
} from "../../services/operations-ledger"
import {
  cancelOperationBodySchema,
  completeOperationStageBodySchema,
  evaluateOperationBodySchema,
  generateOperationBodySchema,
  rollbackOperationBodySchema,
  startOperationStageBodySchema,
  submitOperationBodySchema,
  type CancelOperationBody,
  type CompleteOperationStageBody,
  type EvaluateOperationBody,
  type GenerateOperationBody,
  type RollbackOperationBody,
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

type ContentOperationBody =
  | EvaluateOperationBody
  | GenerateOperationBody
  | RollbackOperationBody

const INTERNAL_OPERATION_ENDPOINT_BY_TYPE: Readonly<
  Record<Exclude<OperationType, "publish">, string>
> = {
  evaluate: "/internal/operations/evaluate",
  generate: "/internal/operations/generate",
  rollback: "/internal/operations/rollback",
}

const submitContentOperation = async (
  req: PayloadRequest,
  ctx: { readonly requestId: string },
  body: ContentOperationBody,
  operationType: Exclude<OperationType, "publish">,
): Promise<Response> => {
  const idempotencyKey = req.headers?.get("idempotency-key")
  if (idempotencyKey === null || idempotencyKey === undefined) {
    throw new OperationsLedgerError("OPERATIONS_INPUT_INVALID", "missing idempotency key")
  }
  const requestPayload = {
    body,
    requestHash: operationRequestHashOf(body),
  }
  const outcome = await submitOperation(req.payload, {
    endpoint: INTERNAL_OPERATION_ENDPOINT_BY_TYPE[operationType],
    idempotencyKey,
    operationType,
    requestPayload,
    user: req.user,
  })
  const response = internalJsonResponse(
    outcome.created ? 202 : 200,
    { created: outcome.created, operation: outcome.operation },
    ctx.requestId,
    null,
  )
  if (!outcome.created) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.set("location", `/internal/operations/${outcome.operation.operationId}`)
  return new Response(response.body, { headers, status: response.status })
}

const handleGenerateOperation = withInternalGuards(
  {
    bodySchema: generateOperationBodySchema,
    operation: "generateOperation",
    requiresIdempotencyKey: true,
  },
  (req, ctx, body: GenerateOperationBody) => submitContentOperation(req, ctx, body, "generate"),
)

const handleEvaluateOperation = withInternalGuards(
  {
    bodySchema: evaluateOperationBodySchema,
    operation: "evaluateOperation",
    requiresIdempotencyKey: true,
  },
  (req, ctx, body: EvaluateOperationBody) => submitContentOperation(req, ctx, body, "evaluate"),
)

const handleRollbackOperation = withInternalGuards(
  {
    bodySchema: rollbackOperationBodySchema,
    operation: "rollbackOperation",
    requiresIdempotencyKey: true,
  },
  (req, ctx, body: RollbackOperationBody) => submitContentOperation(req, ctx, body, "rollback"),
)

const handleSubmitOperation = withInternalGuards(
  { bodySchema: submitOperationBodySchema, operation: "submitOperation" },
  async (req, ctx, body: SubmitOperationBody) => {
    if (body.operationType === "publish") {
      throw new OperationsLedgerError(
        "OPERATIONS_INPUT_INVALID",
        "publisher identity must submit publish operations",
      )
    }
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
  evaluateOperation: handleEvaluateOperation,
  generateOperation: handleGenerateOperation,
  getOperation: handleGetOperation,
  listNonTerminalOperations: handleListNonTerminal,
  rollbackOperation: handleRollbackOperation,
  startOperationStage: handleStartStage,
  submitOperation: handleSubmitOperation,
}

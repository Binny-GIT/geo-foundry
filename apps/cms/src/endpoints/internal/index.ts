import { connectorHandlerByOperation } from "./connectors"
import { editionHandlerByOperation } from "./editions"
import type { InternalHandler } from "./guards"
import { intakeHandlerByOperation } from "./intake"
import { INTERNAL_OPERATIONS } from "./openapi"
import { operationHandlerByOperation } from "./operations"
import { publicationPlanHandlerByOperation } from "./publication-plans"
import { releaseHandlerByOperation } from "./releases"
import { rollbackIntentHandlerByOperation } from "./rollback-intents"
import { handleGetCompileSnapshot } from "./sites"

const handlerByOperation: Record<string, InternalHandler> = {
  ...connectorHandlerByOperation,
  ...editionHandlerByOperation,
  ...intakeHandlerByOperation,
  ...operationHandlerByOperation,
  ...publicationPlanHandlerByOperation,
  ...releaseHandlerByOperation,
  ...rollbackIntentHandlerByOperation,
  getCompileSnapshot: handleGetCompileSnapshot,
}

export type InternalEndpoint = Readonly<{
  handler: InternalHandler
  method: "get" | "post"
  operationId: string
  path: string
}>

export const allInternalEndpoints: readonly InternalEndpoint[] = INTERNAL_OPERATIONS.map(
  (operation) => {
    const handler = handlerByOperation[operation.operationId]
    if (handler === undefined) {
      throw new Error(`missing internal handler for ${operation.operationId}`)
    }
    return {
      handler,
      method: operation.method,
      operationId: operation.operationId,
      path: operation.path,
    }
  },
)

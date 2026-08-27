import type { Endpoint } from "payload"

import { editionHandlerByOperation } from "./editions"
import { intakeHandlerByOperation } from "./intake"
import { INTERNAL_OPERATIONS } from "./openapi"
import { operationHandlerByOperation } from "./operations"
import { publicationPlanHandlerByOperation } from "./publication-plans"
import { releaseHandlerByOperation } from "./releases"
import { rollbackIntentHandlerByOperation } from "./rollback-intents"
import { handleGetCompileSnapshot } from "./sites"

const handlerByOperation: Record<string, (typeof allInternalEndpoints)[number]["handler"]> = {
  ...editionHandlerByOperation,
  ...intakeHandlerByOperation,
  ...operationHandlerByOperation,
  ...publicationPlanHandlerByOperation,
  ...releaseHandlerByOperation,
  ...rollbackIntentHandlerByOperation,
  getCompileSnapshot: handleGetCompileSnapshot,
}

export const allInternalEndpoints: readonly Endpoint[] = INTERNAL_OPERATIONS.map((operation) => {
  const handler = handlerByOperation[operation.operationId]
  if (handler === undefined) {
    throw new Error(`missing internal handler for ${operation.operationId}`)
  }
  return {
    handler,
    method: operation.method,
    path: operation.path,
  }
})

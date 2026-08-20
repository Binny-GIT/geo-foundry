import type { Endpoint } from "payload"

import { editionHandlerByOperation } from "./editions"
import { operationHandlerByOperation } from "./operations"
import { handleGetCompileSnapshot } from "./sites"
import { INTERNAL_OPERATIONS } from "./openapi"

const handlerByOperation: Record<string, (typeof allInternalEndpoints)[number]["handler"]> = {
  ...editionHandlerByOperation,
  ...operationHandlerByOperation,
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

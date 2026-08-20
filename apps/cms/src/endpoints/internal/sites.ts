import type { PayloadRequest } from "payload"

import { buildCompileSnapshot } from "../../services/compile-snapshot"
import { EditionWorkflowError } from "../../services/edition-workflow"
import { internalJsonResponse, withInternalGuards } from "./guards"

const siteIdOf = (req: PayloadRequest): number => {
  const raw = req.routeParams?.["id"]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EditionWorkflowError("COMPILE_SNAPSHOT_SITE_INVALID", `route id ${String(raw)}`)
  }
  return parsed
}

export const handleGetCompileSnapshot = withInternalGuards(
  { bodySchema: null, operation: "getCompileSnapshot" },
  async (req, ctx) => {
    const snapshot = await buildCompileSnapshot(req.payload, {
      siteId: siteIdOf(req),
      user: req.user,
    })
    return internalJsonResponse(200, snapshot, ctx.requestId, null)
  },
)

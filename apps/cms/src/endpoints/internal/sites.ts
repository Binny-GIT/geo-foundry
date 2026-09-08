import { buildCompileSnapshot } from "../../server/repositories/compile-snapshot"
import { serverRuntime } from "../../server/runtime"
import { EditionWorkflowError } from "../../services/edition-workflow"
import { type InternalRequest, internalJsonResponse, withInternalGuards } from "./guards"

const siteIdOf = (req: InternalRequest): number => {
  const raw = req.routeParams["id"]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EditionWorkflowError("COMPILE_SNAPSHOT_SITE_INVALID", `route id ${String(raw)}`)
  }
  return parsed
}

export const handleGetCompileSnapshot = withInternalGuards(
  { bodySchema: null, operation: "getCompileSnapshot" },
  async (req, ctx) => {
    const snapshot = await buildCompileSnapshot(serverRuntime().db, {
      siteId: siteIdOf(req),
      user: req.user,
    })
    return internalJsonResponse(200, snapshot, ctx.requestId, null)
  },
)

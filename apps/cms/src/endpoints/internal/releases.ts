import {
  recordPublishedRelease,
  recordRollbackReceipt,
} from "../../server/repositories/release-registry"
import { serverRuntime } from "../../server/runtime"
import { type ReleaseReceiptBody, releaseReceiptBodySchema } from "./contracts"
import { type InternalRequest, internalJsonResponse, withInternalGuards } from "./guards"

const siteIdOf = (req: InternalRequest): number => {
  const raw = req.routeParams["id"]
  const siteId = Number(raw)
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(`RELEASE_SITE_INVALID: ${String(raw)}`)
  }
  return siteId
}

const handleRecordPublishedRelease = withInternalGuards(
  { bodySchema: releaseReceiptBodySchema, operation: "recordPublishedRelease" },
  async (req, ctx, body: ReleaseReceiptBody) => {
    await recordPublishedRelease(serverRuntime().db, {
      ...(body.editionId === undefined ? {} : { editionId: body.editionId }),
      operationId: body.operationId,
      receipt: body.receipt,
      siteId: siteIdOf(req),
      user: req.user,
    })
    return internalJsonResponse(200, { recorded: true }, ctx.requestId, null)
  },
)

const handleRecordRollbackReceipt = withInternalGuards(
  { bodySchema: releaseReceiptBodySchema, operation: "recordRollbackReceipt" },
  async (req, ctx, body: ReleaseReceiptBody) => {
    await recordRollbackReceipt(serverRuntime().db, {
      operationId: body.operationId,
      receipt: body.receipt,
      user: req.user,
    })
    return internalJsonResponse(200, { recorded: true }, ctx.requestId, null)
  },
)

export const releaseHandlerByOperation: Record<string, typeof handleRecordPublishedRelease> = {
  recordPublishedRelease: handleRecordPublishedRelease,
  recordRollbackReceipt: handleRecordRollbackReceipt,
}

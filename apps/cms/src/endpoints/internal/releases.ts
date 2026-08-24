import type { PayloadRequest } from "payload"

import { recordPublishedRelease, recordRollbackReceipt } from "../../services/release-registry"
import { type ReleaseReceiptBody, releaseReceiptBodySchema } from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const siteIdOf = (req: PayloadRequest): number => {
  const raw = req.routeParams?.["id"]
  const siteId = Number(raw)
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(`RELEASE_SITE_INVALID: ${String(raw)}`)
  }
  return siteId
}

const handleRecordPublishedRelease = withInternalGuards(
  { bodySchema: releaseReceiptBodySchema, operation: "recordPublishedRelease" },
  async (req, ctx, body: ReleaseReceiptBody) => {
    await recordPublishedRelease(req.payload, {
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
    await recordRollbackReceipt(req.payload, {
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

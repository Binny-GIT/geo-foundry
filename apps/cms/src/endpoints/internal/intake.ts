import type { PayloadRequest } from "payload"

import {
  claimIntakeFetch,
  completeIntakeFetch,
  createRssIntakeEntries,
  failIntakeFetch,
  type IntakeFetchCompletion,
  readIntakeFetchInput,
} from "../../services/intake-fetch"
import {
  type IntakeFetchCompleteBody,
  type IntakeFetchFailedBody,
  type IntakeRssEntriesBody,
  intakeFetchCompleteBodySchema,
  intakeFetchFailedBodySchema,
  intakeRssEntriesBodySchema,
} from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const intakeItemIdOf = (req: PayloadRequest): number => {
  const id = Number(req.routeParams?.["id"])
  if (!Number.isInteger(id) || id <= 0) throw new Error("INTAKE_ITEM_ID_INVALID")
  return id
}

const handleClaimIntakeFetch = withInternalGuards(
  { bodySchema: null, operation: "claimIntakeFetch" },
  async (req, ctx) => {
    await claimIntakeFetch(req.payload, intakeItemIdOf(req), req.user)
    return internalJsonResponse(200, { claimed: true }, ctx.requestId, null)
  },
)

const handleGetIntakeFetchInput = withInternalGuards(
  { bodySchema: null, operation: "getIntakeFetchInput" },
  async (req, ctx) =>
    internalJsonResponse(
      200,
      await readIntakeFetchInput(req.payload, intakeItemIdOf(req), req.user),
      ctx.requestId,
      null,
    ),
)

const handleCompleteIntakeFetch = withInternalGuards(
  { bodySchema: intakeFetchCompleteBodySchema, operation: "completeIntakeFetch" },
  async (req, ctx, body: IntakeFetchCompleteBody) => {
    const input: IntakeFetchCompletion = { ...body, intakeItemId: intakeItemIdOf(req) }
    const receipt = await completeIntakeFetch(req.payload, input, req.user)
    return internalJsonResponse(200, receipt, ctx.requestId, null)
  },
)

const handleFailIntakeFetch = withInternalGuards(
  { bodySchema: intakeFetchFailedBodySchema, operation: "failIntakeFetch" },
  async (req, ctx, body: IntakeFetchFailedBody) => {
    await failIntakeFetch(req.payload, { ...body, intakeItemId: intakeItemIdOf(req) }, req.user)
    return internalJsonResponse(200, { failed: true }, ctx.requestId, null)
  },
)

const handleCreateRssEntries = withInternalGuards(
  { bodySchema: intakeRssEntriesBodySchema, operation: "createRssEntries" },
  async (req, ctx, body: IntakeRssEntriesBody) => {
    const intakeItemIds = await createRssIntakeEntries(
      req.payload,
      {
        entries: body.entries.map((entry) => ({
          sourceUrl: entry.sourceUrl,
          ...(entry.summary === undefined ? {} : { summary: entry.summary }),
          title: entry.title,
        })),
        intakeItemId: intakeItemIdOf(req),
      },
      req.user,
    )
    return internalJsonResponse(200, { intakeItemIds }, ctx.requestId, null)
  },
)

export const intakeHandlerByOperation: Record<string, typeof handleGetIntakeFetchInput> = {
  claimIntakeFetch: handleClaimIntakeFetch,
  completeIntakeFetch: handleCompleteIntakeFetch,
  createRssEntries: handleCreateRssEntries,
  failIntakeFetch: handleFailIntakeFetch,
  getIntakeFetchInput: handleGetIntakeFetchInput,
}

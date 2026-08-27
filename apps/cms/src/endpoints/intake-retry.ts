import type { Endpoint, PayloadRequest } from "payload"

import { enqueueIntakeFetchFromEnvironment } from "../services/intake-queue"
import { IntakeError, scheduleIntakeFetch } from "../services/intake"
import { resolveSessionClaims } from "../access/session"

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const intakeItemIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const intakeErrorResponse = (error: IntakeError): Response => {
  const status =
    error.code === "INTAKE_ITEM_NOT_FOUND"
      ? 404
      : error.code === "INTAKE_TENANT_MISMATCH" ||
          error.code === "INTAKE_EDITOR_REQUIRED" ||
          error.code === "INTAKE_ACTOR_INVALID"
        ? 403
        : error.code === "INTAKE_FETCH_STATE_INVALID"
          ? 409
          : 400
  return response(status, { error: { code: error.code } })
}

/** Re-enqueues a failed tenant-scoped URL/RSS item with its stable job identity. */
export const retryIntakeItemEndpoint: Endpoint = {
  handler: async (req) => {
    const claims = resolveSessionClaims(req.user)
    if (claims === null) return response(401, { error: { code: "INTAKE_UNAUTHENTICATED" } })
    if (claims.role !== "editor" && claims.role !== "tenant-admin" && claims.role !== "content-service") {
      return response(403, { error: { code: "INTAKE_EDITOR_REQUIRED" } })
    }
    const intakeItemId = intakeItemIdOf(req)
    if (intakeItemId === null) return response(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
    try {
      const intakeItem = await scheduleIntakeFetch(
        req.payload,
        intakeItemId,
        req.user,
        enqueueIntakeFetchFromEnvironment,
      )
      return response(202, { intakeItem })
    } catch (error) {
      if (error instanceof IntakeError) return intakeErrorResponse(error)
      return response(503, { error: { code: "INTAKE_QUEUE_UNAVAILABLE" } })
    }
  },
  method: "post",
  path: "/intake-operations/:id/retry",
}

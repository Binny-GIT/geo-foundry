import type { Endpoint, PayloadRequest } from "payload"

import { resolveSessionClaims } from "../access/session"
import { duplicateEdition, EditionDuplicateError } from "../services/edition-duplicate"

const editionIdOf = (req: PayloadRequest): number | null => {
  const id = Number(req.routeParams?.["id"])
  return Number.isInteger(id) && id > 0 ? id : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorStatusOf = (code: string): number =>
  code === "EDITION_DUPLICATE_UNAUTHENTICATED"
    ? 401
    : code === "EDITION_DUPLICATE_FORBIDDEN"
      ? 403
      : code === "EDITION_DUPLICATE_NOT_FOUND" || code === "EDITION_DUPLICATE_TENANT_MISMATCH"
        ? 404
        : 400

export const editionDuplicateEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) {
      return response(400, { error: { code: "EDITION_DUPLICATE_ID_INVALID" } })
    }
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "EDITION_DUPLICATE_UNAUTHENTICATED" } })
    }
    try {
      const result = await duplicateEdition(req.payload, { editionId, user: req.user })
      return response(201, result)
    } catch (error) {
      if (error instanceof EditionDuplicateError) {
        return response(errorStatusOf(error.code), { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/editions/:id/duplicate",
}

import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { applyEditionAssignment, EditionAssignmentError } from "../services/edition-assignment"

const bodySchema = z
  .object({
    owner: z.number().int().positive().nullable().optional(),
    site: z.number().int().positive().optional(),
  })
  .strict()

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
  code === "EDITION_ASSIGNMENT_UNAUTHENTICATED"
    ? 401
    : code === "EDITION_ASSIGNMENT_FORBIDDEN" || code === "EDITION_ASSIGNMENT_TENANT_MISMATCH"
      ? 403
      : code === "EDITION_ASSIGNMENT_NOT_FOUND" ||
          code === "EDITION_ASSIGNMENT_OWNER_NOT_FOUND" ||
          code === "EDITION_ASSIGNMENT_SITE_NOT_FOUND"
        ? 404
        : 409

export const editionAssignmentEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) {
      return response(400, { error: { code: "EDITION_ASSIGNMENT_ID_INVALID" } })
    }
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "EDITION_ASSIGNMENT_UNAUTHENTICATED" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "EDITION_ASSIGNMENT_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "EDITION_ASSIGNMENT_BODY_INVALID" } })
    }
    try {
      const result = await applyEditionAssignment(req.payload, {
        editionId,
        ...(parsed.data.owner === undefined ? {} : { owner: parsed.data.owner }),
        ...(parsed.data.site === undefined ? {} : { site: parsed.data.site }),
        user: req.user,
      })
      return response(200, result)
    } catch (error) {
      if (error instanceof EditionAssignmentError) {
        return response(errorStatusOf(error.code), { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/editions/:id/assignment",
}

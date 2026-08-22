import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { renameUrlRecord } from "../services/url-registry"
import { UrlRegistryError } from "../services/url-registry-errors"

const bodySchema = z
  .object({
    locale: z.string().min(2).max(64),
    pathname: z.string().min(1).max(2_000).startsWith("/"),
  })
  .strict()

const recordIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const renameUrlRecordEndpoint: Endpoint = {
  handler: async (req) => {
    const recordId = recordIdOf(req)
    if (recordId === null) {
      return response(400, { error: { code: "URL_RECORD_ID_INVALID" } })
    }
    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return response(401, { error: { code: "URL_RECORD_UNAUTHENTICATED" } })
    }
    if (claims.kind !== "user" || (claims.role !== "editor" && claims.role !== "publisher")) {
      return response(403, { error: { code: "URL_RECORD_RENAME_FORBIDDEN" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "URL_RECORD_RENAME_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "URL_RECORD_RENAME_BODY_INVALID" } })
    }
    try {
      const source = await req.payload.findByID({
        collection: "url-records",
        depth: 0,
        id: recordId,
        overrideAccess: true,
      })
      if (String(source.tenant) !== String(claims.tenantId)) {
        return response(403, { error: { code: "URL_RECORD_TENANT_MISMATCH" } })
      }
      const receipt = await renameUrlRecord(req.payload, {
        locale: parsed.data.locale,
        pathname: parsed.data.pathname,
        recordId,
      })
      return response(200, receipt)
    } catch (error) {
      if (error instanceof UrlRegistryError) {
        return response(409, { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/url-record-operations/:id/rename",
}

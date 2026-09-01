import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { createSiteVariant, SiteVariantError } from "../services/site-variants"

const bodySchema = z.object({ siteId: z.number().int().positive() }).strict()
const editionIdOf = (req: PayloadRequest): number | null => {
  const id = Number(req.routeParams?.["id"])
  return Number.isInteger(id) && id > 0 ? id : null
}
const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const createSiteVariantEndpoint: Endpoint = {
  handler: async (req) => {
    if (resolveSessionClaims(req.user) === null)
      return response(401, { error: { code: "SITE_VARIANT_UNAUTHENTICATED" } })
    const editionId = editionIdOf(req)
    const parsed = bodySchema.safeParse(await req.json?.().catch(() => null))
    if (editionId === null || !parsed.success)
      return response(400, { error: { code: "SITE_VARIANT_BODY_INVALID" } })
    try {
      return response(
        201,
        await createSiteVariant(req.payload, {
          editionId,
          siteId: parsed.data.siteId,
          user: req.user,
        }),
      )
    } catch (error) {
      if (!(error instanceof SiteVariantError)) throw error
      const status =
        error.code === "SITE_VARIANT_NOT_FOUND" || error.code === "SITE_VARIANT_TENANT_MISMATCH"
          ? 404
          : error.code === "SITE_VARIANT_EDITOR_REQUIRED"
            ? 403
            : error.code === "SITE_VARIANT_ALREADY_EXISTS" ||
                error.code === "SITE_VARIANT_TARGET_SAME_SITE"
              ? 409
              : 400
      return response(status, { error: { code: error.code } })
    }
  },
  method: "post",
  path: "/editions/:id/site-variants",
}

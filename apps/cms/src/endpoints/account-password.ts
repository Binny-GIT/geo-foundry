import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { CMS_ROLE } from "../access/roles"
import { resolveSessionClaims } from "../access/session"

/*
 * Self-service password change for human console sessions. The current
 * password is re-verified through the same credential path as login — a live
 * session alone never authorizes a silent rotation — and the update touches
 * only the password field (role/tenant stay as stored, so the
 * user-tenant-invariant beforeChange hook passes via its originalDoc
 * fallback). Service identities (content-service) never rotate passwords
 * here; their credentials are tenant keyring API keys.
 */
const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .strict()

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const changeOwnPasswordEndpoint: Endpoint = {
  handler: async (req: PayloadRequest) => {
    const claims = resolveSessionClaims(req.user)
    if (claims === null) {
      return response(401, { error: { code: "ACCOUNT_PASSWORD_UNAUTHENTICATED" } })
    }
    if (claims.role === CMS_ROLE.CONTENT_SERVICE) {
      return response(403, { error: { code: "ACCOUNT_PASSWORD_ROLE_FORBIDDEN" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "ACCOUNT_PASSWORD_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return response(400, { error: { code: "ACCOUNT_PASSWORD_BODY_INVALID" } })

    const email = typeof req.user?.email === "string" ? req.user.email : ""
    /*
     * Re-verify the current password through the login credential path —
     * payload.login validates email+password exactly like sign-in and throws
     * on mismatch; a live session alone never authorizes a silent rotation.
     */
    let verifiedUserId: number | string | null = null
    try {
      const login = await req.payload.login({
        collection: "users",
        data: { email, password: parsed.data.currentPassword },
        req,
      })
      verifiedUserId = login.user?.id ?? null
    } catch {
      verifiedUserId = null
    }
    if (verifiedUserId === null || String(verifiedUserId) !== claims.userId) {
      return response(400, { error: { code: "ACCOUNT_PASSWORD_CURRENT_INVALID" } })
    }

    await req.payload.update({
      collection: "users",
      data: { password: parsed.data.newPassword },
      id: claims.userId,
      overrideAccess: true,
    })
    return response(200, { ok: true })
  },
  method: "post",
  path: "/users/me/password",
}

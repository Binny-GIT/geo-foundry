import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getPayload } from "payload"

import { CMS_ACTION, decideAccess, type CmsAction, type CmsResource } from "@/access/policy"
import { CMS_ROLE, type CmsRole } from "@/access/roles"
import { resolveSessionClaims, type SessionClaims } from "@/access/session"
import config from "@payload-config"

export type ConsoleSession = {
  readonly email: string
  readonly id: string
  readonly role: CmsRole
  readonly tenantId: string | number | null
}

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const sessionFromClaims = (user: unknown, claims: SessionClaims): ConsoleSession | null => {
  if (typeof user !== "object" || user === null) return null
  const email = stringValue((user as Record<string, unknown>)["email"])
  if (email === null) return null
  return Object.freeze({
    email,
    id: claims.userId,
    role: claims.role,
    tenantId: claims.tenantId,
  })
}

/**
 * The Console consumes the same HTTP-only Payload auth cookie as the REST
 * endpoints. It never decodes a client token or trusts role data posted by a
 * browser; malformed sessions are denied through resolveSessionClaims().
 */
export const getConsoleSession = async (): Promise<ConsoleSession | null> => {
  const payload = await getPayload({ config })
  const result = await payload.auth({ headers: await headers() })
  const claims = resolveSessionClaims(result.user)
  return claims === null ? null : sessionFromClaims(result.user, claims)
}

export const requireConsoleSession = async (next = "/admin"): Promise<ConsoleSession> => {
  const session = await getConsoleSession()
  if (session !== null && session.role !== CMS_ROLE.CONTENT_SERVICE) return session
  redirect(`/admin/login?next=${encodeURIComponent(next)}`)
}

export const requireEmergencySuperAdmin = async (): Promise<ConsoleSession> => {
  const session = await getConsoleSession()
  if (session?.role === CMS_ROLE.SUPER_ADMIN) return session
  redirect("/admin")
}

export const canConsole = (
  session: ConsoleSession,
  resource: CmsResource,
  action: CmsAction,
): boolean =>
  decideAccess(
    {
      kind: session.role === CMS_ROLE.CONTENT_SERVICE ? "service" : "user",
      role: session.role,
      tenantId: session.tenantId,
      userId: session.id,
    },
    resource,
    action,
  )

export const canConsoleCreate = (session: ConsoleSession, resource: CmsResource): boolean =>
  canConsole(session, resource, CMS_ACTION.CREATE)

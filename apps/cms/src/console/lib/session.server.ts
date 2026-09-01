import "server-only"

import config from "@payload-config"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getPayload } from "payload"
import { CMS_ACTION, type CmsAction, type CmsResource, decideAccess } from "@/access/policy"
import { CMS_ROLE, type CmsRole } from "@/access/roles"
import { resolveSessionClaims, type SessionClaims } from "@/access/session"

export type ConsoleSession = {
  readonly email: string
  readonly id: string
  readonly role: CmsRole
  readonly siteIds: readonly number[] | null
  readonly tenantId: string | number | null
  readonly tenantName: string | null
}

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const sessionFromClaims = (user: unknown, claims: SessionClaims): ConsoleSession | null => {
  if (typeof user !== "object" || user === null) return null
  const email = stringValue((user as Record<string, unknown>)["email"])
  if (email === null) return null
  const unrestricted = claims.role === CMS_ROLE.SUPER_ADMIN || claims.role === CMS_ROLE.TENANT_ADMIN
  const rawSites = (user as Record<string, unknown>)["sites"]
  const siteIds = Array.isArray(rawSites)
    ? rawSites.filter((id): id is number => typeof id === "number" && id > 0)
    : []
  return Object.freeze({
    email,
    id: claims.userId,
    role: claims.role,
    siteIds: unrestricted || siteIds.length === 0 ? null : siteIds,
    tenantId: claims.tenantId,
    tenantName: null,
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
  const session = claims === null ? null : sessionFromClaims(result.user, claims)
  if (session === null || session.tenantId === null) return session
  try {
    const tenant = (await payload.findByID({
      collection: "tenants",
      depth: 0,
      id: session.tenantId,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    const name = stringValue(tenant["name"])
    return Object.freeze({ ...session, tenantName: name })
  } catch {
    return session
  }
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

/**
 * The Payload subtree hosts the canonical three-pane edition workspace, so any
 * authenticated session may enter; every collection operation inside still
 * goes through the server-side RBAC matrix.
 */
export const requireEmergencySession = async (next = "/admin"): Promise<ConsoleSession> => {
  const session = await getConsoleSession()
  if (session !== null && session.role !== CMS_ROLE.CONTENT_SERVICE) return session
  redirect(`/admin/login?next=${encodeURIComponent(next)}`)
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

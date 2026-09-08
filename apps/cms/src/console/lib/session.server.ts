import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { CMS_ACTION, type CmsAction, type CmsResource, decideAccess } from "@/access/policy"
import { CMS_ROLE, type CmsRole } from "@/access/roles"
import { normalizeConsoleNext } from "@/console/lib/console-next"
import { authenticateRequest, type AuthenticatedRequest } from "@/server/auth/session"
import { EntitiesRepository } from "@/server/repositories/entities"
import { serverRuntime } from "@/server/runtime"

export type ConsoleSession = {
  readonly email: string
  readonly id: string
  readonly role: CmsRole
  readonly siteIds: readonly number[] | null
  readonly tenantId: string | number | null
  readonly tenantName: string | null
}

const sessionFromAuth = (auth: AuthenticatedRequest): ConsoleSession => {
  const unrestricted =
    auth.claims.role === CMS_ROLE.SUPER_ADMIN || auth.claims.role === CMS_ROLE.TENANT_ADMIN
  return Object.freeze({
    email: auth.user.email,
    id: auth.claims.userId,
    role: auth.claims.role,
    siteIds: unrestricted || auth.siteIds.length === 0 ? null : auth.siteIds,
    tenantId: auth.claims.tenantId,
    tenantName: null,
  })
}

/**
 * Console 页面守卫直接解析现有 payload-token：兼容验签、active sid、用户与
 * tenant invariant 全部由自建认证层完成，不再依赖 Payload 认证管线。
 */
export const getConsoleSession = async (): Promise<ConsoleSession | null> => {
  const auth = await authenticateRequest(await headers())
  if (auth === null) return null
  const session = sessionFromAuth(auth)
  if (session.tenantId === null) return session
  const tenantId = Number(session.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return null
  const tenantName = await new EntitiesRepository(serverRuntime().db).tenantName(tenantId)
  return Object.freeze({ ...session, tenantName })
}

export const isHumanConsoleSession = (session: ConsoleSession | null): session is ConsoleSession =>
  session !== null && session.role !== CMS_ROLE.CONTENT_SERVICE

export const requireConsoleSession = async (next = "/admin"): Promise<ConsoleSession> => {
  const session = await getConsoleSession()
  if (isHumanConsoleSession(session)) return session
  redirect(`/admin/login?next=${encodeURIComponent(normalizeConsoleNext(next))}`)
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

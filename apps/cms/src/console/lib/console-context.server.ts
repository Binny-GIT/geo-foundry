import "server-only"

import { notFound } from "next/navigation"

import { CMS_ACTION, type CmsResource } from "@/access/policy"
import type { ServerDb } from "@/server/db/client"
import { type EntityScope, entityScopeFor } from "@/server/repositories/entities"
import { serverRuntime } from "@/server/runtime"
import { CONSOLE_RESOURCES, type ConsoleResourceSlug, isConsoleResourceSlug } from "./resources"
import {
  type ConsoleSession,
  canConsole,
  getConsoleSession,
  isHumanConsoleSession,
} from "./session.server"

export type ConsoleContext = Readonly<{
  db: ServerDb
  /** 权限矩阵范围：super-admin 全局，其余角色绑定租户（与 Payload readScope 等价）。 */
  scope: EntityScope
  session: ConsoleSession
  /** Console 显示收窄：editor/reviewer/publisher 的站点范围；null 表示不收窄。 */
  siteIds: readonly number[] | null
}>

/**
 * Console 页面数据上下文：认证由自建会话层完成，数据读取直接走 Drizzle。
 * 非人类会话（content-service）或无效租户绑定一律 notFound。
 */
export const requireConsoleContext = async (): Promise<ConsoleContext> => {
  const session = await getConsoleSession()
  if (!isHumanConsoleSession(session)) notFound()
  const scope = entityScopeFor({
    role: session.role,
    siteIds: session.siteIds ?? [],
    tenantId: session.tenantId,
  })
  if (scope === null) notFound()
  return { db: serverRuntime().db, scope, session, siteIds: session.siteIds }
}

export const requireReadableConsoleResource = (
  session: ConsoleSession,
  slug: string,
): ConsoleResourceSlug => {
  if (!isConsoleResourceSlug(slug)) notFound()
  const resource = CONSOLE_RESOURCES[slug]
  if (resource.resource === null || !canConsole(session, resource.resource, CMS_ACTION.READ)) {
    notFound()
  }
  return slug
}

export const canRead = (session: ConsoleSession, resource: CmsResource): boolean =>
  canConsole(session, resource, CMS_ACTION.READ)

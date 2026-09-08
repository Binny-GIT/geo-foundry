import "server-only"

import config from "@payload-config"
import { notFound } from "next/navigation"
import { getPayload, type Payload, type Where } from "payload"

import { CMS_ACTION, type CmsResource } from "@/access/policy"
import { CONSOLE_RESOURCES, type ConsoleResourceSlug, isConsoleResourceSlug } from "./resources"
import {
  type ConsoleSession,
  canConsole,
  getConsoleSession,
  isHumanConsoleSession,
} from "./session.server"

 type RecordLike = Record<string, unknown>

type PayloadUserContext = RecordLike & {
  readonly collection: "users"
  readonly email: string
  readonly id: number
  readonly role: ConsoleSession["role"]
  readonly sites: readonly number[]
  readonly tenant: number | null
}

type PayloadContext = {
  readonly payload: Payload
  readonly session: ConsoleSession
  readonly user: PayloadUserContext
}

const payloadUserOf = (session: ConsoleSession): PayloadUserContext | null => {
  const id = Number(session.id)
  if (!Number.isInteger(id) || id <= 0) return null
  const tenantId = session.tenantId === null ? null : Number(session.tenantId)
  if (session.tenantId !== null && (!Number.isInteger(tenantId) || (tenantId ?? 0) <= 0)) {
    return null
  }
  return {
    _strategy: "compat-session",
    collection: "users",
    email: session.email,
    id,
    role: session.role,
    sites: session.siteIds ?? [],
    tenant: tenantId,
  }
}

/**
 * 混合迁移窗口：认证由 compat layer 完成；Payload 仅作为尚未迁出集合的
 * Local API adapter。user 上下文从已验证 ConsoleSession 重建，Payload 不再
 * 参与认证判断；旧 cookie 与 active sid 语义仍完全兼容。
 */
export const requireConsolePayloadContext = async (): Promise<PayloadContext> => {
  const session = await getConsoleSession()
  if (!isHumanConsoleSession(session)) notFound()
  const user = payloadUserOf(session)
  if (user === null) notFound()
  const payload = await getPayload({ config })
  return { payload, session, user }
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

export const findConsoleDocuments = async ({
  limit = 20,
  page = 1,
  slug,
  where,
}: {
  readonly limit?: number
  readonly page?: number
  readonly slug: ConsoleResourceSlug
  readonly where?: Where | undefined
}) => {
  const context = await requireConsolePayloadContext()
  const readableSlug = requireReadableConsoleResource(context.session, slug)
  const result = await context.payload.find({
    collection: readableSlug,
    depth: CONSOLE_RESOURCES[readableSlug].relationshipColumns === undefined ? 0 : 1,
    limit: Math.min(Math.max(limit, 1), 100),
    overrideAccess: false,
    page: Math.max(page, 1),
    sort: "-updatedAt",
    user: context.user,
    ...(where === undefined ? {} : { where }),
  })
  return {
    docs: result.docs as unknown as readonly RecordLike[],
    page: result.page ?? page,
    totalDocs: result.totalDocs ?? 0,
    totalPages: result.totalPages ?? 0,
  }
}

export const findConsoleDocument = async ({
  id,
  slug,
}: {
  readonly id: number | string
  readonly slug: ConsoleResourceSlug
}): Promise<RecordLike> => {
  const context = await requireConsolePayloadContext()
  const readableSlug = requireReadableConsoleResource(context.session, slug)
  try {
    return (await context.payload.findByID({
      collection: readableSlug,
      depth: CONSOLE_RESOURCES[readableSlug].relationshipColumns === undefined ? 0 : 1,
      id,
      overrideAccess: false,
      user: context.user,
    })) as unknown as RecordLike
  } catch {
    notFound()
  }
}

export const countConsoleResource = async (
  context: PayloadContext,
  resource: CmsResource,
  slug: ConsoleResourceSlug,
): Promise<number> => {
  if (!canConsole(context.session, resource, CMS_ACTION.READ)) return 0
  try {
    const result = await context.payload.count({
      collection: slug,
      overrideAccess: false,
      user: context.user,
    })
    return result.totalDocs
  } catch {
    return 0
  }
}

import "server-only"

import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { getPayload, type Payload } from "payload"

import { CMS_ACTION, type CmsResource } from "@/access/policy"
import config from "@payload-config"

import {
  CONSOLE_RESOURCES,
  isConsoleResourceSlug,
  type ConsoleResourceSlug,
} from "./resources"
import {
  canConsole,
  getConsoleSession,
  type ConsoleSession,
} from "./session.server"

type RecordLike = Record<string, unknown>

type PayloadContext = {
  readonly payload: Payload
  readonly session: ConsoleSession
  readonly user: NonNullable<Awaited<ReturnType<Payload["auth"]>>["user"]>
}

export const requireConsolePayloadContext = async (): Promise<PayloadContext> => {
  const payload = await getPayload({ config })
  const result = await payload.auth({ headers: await headers() })
  const session = await getConsoleSession()
  if (session === null || result.user === null || result.user === undefined) {
    notFound()
  }
  return { payload, session, user: result.user }
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
}: {
  readonly limit?: number
  readonly page?: number
  readonly slug: ConsoleResourceSlug
}) => {
  const context = await requireConsolePayloadContext()
  const readableSlug = requireReadableConsoleResource(context.session, slug)
  const result = await context.payload.find({
    collection: readableSlug,
    // Only hydrate relationships that the current session can read. Payload's
    // access layer still applies to nested records, so unreadable references
    // remain absent rather than leaking a title or ID.
    depth: CONSOLE_RESOURCES[readableSlug].relationshipColumns === undefined ? 0 : 1,
    limit: Math.min(Math.max(limit, 1), 100),
    overrideAccess: false,
    page: Math.max(page, 1),
    sort: "-updatedAt",
    user: context.user,
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
    // Both denied and non-existent records intentionally resolve to the same
    // Console not-found surface to preserve Payload's tenant-existence guard.
    notFound()
  }
}

export const countConsoleResource = async (
  context: PayloadContext,
  resource: CmsResource,
  slug: ConsoleResourceSlug,
): Promise<number | null> => {
  if (!canConsole(context.session, resource, CMS_ACTION.READ)) return null
  const result = await context.payload.count({
    collection: slug,
    overrideAccess: false,
    user: context.user,
  })
  return result.totalDocs
}

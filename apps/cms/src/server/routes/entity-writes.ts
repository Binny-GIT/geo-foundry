/*
 * tenants / domains / sites / users 的 POST（创建）与 PATCH（更新）。
 * 响应形状沿用 Payload REST：成功 {doc}，失败 {errors:[{message}]}，
 * Console 表单只依赖这两种形状。
 */

import { CMS_ACTION, CMS_RESOURCE, type CmsResource, decideAccess } from "../../access/policy"
import { authenticateRequest } from "../auth/session"
import { entityScopeOf } from "../repositories/entities"
import {
  createDomain,
  createSite,
  createTenant,
  createUser,
  EntityWriteError,
  updateDomain,
  updateSite,
  updateTenant,
  updateUser,
} from "../repositories/entity-writes"
import { serverRuntime } from "../runtime"

const RESOURCE_BY_SLUG = {
  domains: CMS_RESOURCE.DOMAINS,
  sites: CMS_RESOURCE.SITES,
  tenants: CMS_RESOURCE.TENANTS,
  users: CMS_RESOURCE.USERS,
} as const satisfies Record<string, CmsResource>

type WritableSlug = keyof typeof RESOURCE_BY_SLUG

const isWritableSlug = (value: string | undefined): value is WritableSlug =>
  value !== undefined && Object.hasOwn(RESOURCE_BY_SLUG, value)

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorJson = (status: number, code: string, message?: string): Response =>
  json(status, { errors: [{ message: message ?? code }], message: message ?? code })

const idOf = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null

const readBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const run = async (
  work: () => Promise<Record<string, unknown>>,
  status: number,
): Promise<Response> => {
  try {
    return json(status, { doc: await work() })
  } catch (error) {
    if (error instanceof EntityWriteError) return errorJson(error.status, error.code, error.detail)
    throw error
  }
}

export const handleEntityCreatePost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 1 || !isWritableSlug(slug[0])) return null
  const collection = slug[0]
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  if (!decideAccess(auth.claims, RESOURCE_BY_SLUG[collection], CMS_ACTION.CREATE)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const body = await readBody(request)
  if (body === null) return errorJson(400, "CMS_BODY_INVALID")
  const db = serverRuntime().db
  switch (collection) {
    case "tenants":
      return run(() => createTenant(db, scope, body), 201)
    case "domains":
      return run(() => createDomain(db, scope, auth.claims, body), 201)
    case "sites":
      return run(() => createSite(db, scope, auth.claims, body), 201)
    case "users":
      return run(() => createUser(db, scope, auth.claims, body), 201)
  }
}

export const handleEntityUpdatePatch = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 2 || !isWritableSlug(slug[0])) return null
  const collection = slug[0]
  const id = idOf(slug[1])
  if (id === null) return errorJson(400, "CMS_ID_INVALID")
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  if (!decideAccess(auth.claims, RESOURCE_BY_SLUG[collection], CMS_ACTION.UPDATE)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const body = await readBody(request)
  if (body === null) return errorJson(400, "CMS_BODY_INVALID")
  const db = serverRuntime().db
  switch (collection) {
    case "tenants":
      return run(() => updateTenant(db, scope, id, body), 200)
    case "domains":
      return run(() => updateDomain(db, scope, id, body), 200)
    case "sites":
      return run(() => updateSite(db, scope, id, body), 200)
    case "users":
      return run(() => updateUser(db, scope, auth.claims, id, body), 200)
  }
}

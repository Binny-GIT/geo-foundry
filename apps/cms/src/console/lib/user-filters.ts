import type { Where } from "payload"

import { CMS_ROLE, type CmsRole, isCmsRole } from "../../access/roles"

import { USER_ROLE_LABEL } from "./user-form"

/**
 * Server-side whitelist for the user list filters. Search params are only
 * translated into `where` conditions through this module — the client never
 * supplies arbitrary query structures.
 */

/** Privilege order for the filter dropdown, not the storage order in CMS_ROLES. */
export const USER_ROLE_OPTIONS: readonly { readonly key: CmsRole; readonly label: string }[] = [
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
  CMS_ROLE.EDITOR,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.CONTENT_SERVICE,
].map((role) => ({ key: role, label: USER_ROLE_LABEL[role] }))

export type UserListQuery = {
  readonly page: number
  readonly q: string | null
  readonly role: CmsRole | null
  readonly tenant: number | null
}

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

const positiveInt = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export const parseUserListQuery = (
  searchParams: Record<string, string | string[] | undefined>,
): UserListQuery => {
  const roleRaw = first(searchParams["role"])
  const qRaw = first(searchParams["q"])?.trim() ?? ""
  return {
    page: positiveInt(first(searchParams["page"])) ?? 1,
    q: qRaw.length === 0 ? null : qRaw.slice(0, 100),
    role: isCmsRole(roleRaw) ? roleRaw : null,
    tenant: positiveInt(first(searchParams["tenant"])),
  }
}

export const userListWhere = (query: UserListQuery): Where | undefined => {
  const conditions: Where[] = []
  if (query.role !== null) conditions.push({ role: { equals: query.role } })
  if (query.tenant !== null) conditions.push({ tenant: { equals: query.tenant } })
  if (query.q !== null) conditions.push({ email: { like: query.q } })
  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0] : { and: conditions }
}

export const userListHref = (
  query: UserListQuery,
  overrides: Partial<Omit<UserListQuery, "page">> & { page?: number } = {},
): string => {
  const merged = { ...query, ...overrides }
  const params = new URLSearchParams()
  if (merged.q !== null) params.set("q", merged.q)
  if (merged.role !== null) params.set("role", merged.role)
  if (merged.tenant !== null) params.set("tenant", String(merged.tenant))
  if (merged.page > 1) params.set("page", String(merged.page))
  const search = params.toString()
  return search.length === 0 ? "/admin/collections/users" : `/admin/collections/users?${search}`
}

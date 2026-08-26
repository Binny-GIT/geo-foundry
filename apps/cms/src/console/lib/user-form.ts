import { CMS_ROLE, CMS_ROLES, isCmsRole, type CmsRole } from "../../access/roles"

export type UserFormActorRole = typeof CMS_ROLE.SUPER_ADMIN | typeof CMS_ROLE.TENANT_ADMIN

export type UserFormInput = {
  readonly email: string
  readonly password?: string
  readonly role: unknown
  readonly tenantId?: string
}

export type UserFormPayload = Readonly<{
  readonly email: string
  readonly password?: string
  readonly role: CmsRole
  readonly tenant?: string
}>

const TENANT_ADMIN_ASSIGNABLE_ROLES: readonly CmsRole[] = [
  CMS_ROLE.TENANT_ADMIN,
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.CONTENT_SERVICE,
]

export const assignableUserRoles = (actorRole: UserFormActorRole): readonly CmsRole[] =>
  actorRole === CMS_ROLE.SUPER_ADMIN ? CMS_ROLES : TENANT_ADMIN_ASSIGNABLE_ROLES

export const isUserRoleAssignable = (
  actorRole: UserFormActorRole,
  value: unknown,
): value is CmsRole => isCmsRole(value) && assignableUserRoles(actorRole).includes(value)

/**
 * Builds the browser payload from fields this Console surface is allowed to
 * expose. Tenant-admin tenant assignment is omitted entirely: Payload binds it
 * to the active server session. The REST API remains authoritative.
 */
export const userFormPayload = (
  actorRole: UserFormActorRole,
  input: UserFormInput,
): UserFormPayload | null => {
  if (!isUserRoleAssignable(actorRole, input.role)) return null

  const email = input.email.trim()
  const password = input.password?.trim()
  const payload: {
    email: string
    password?: string
    role: CmsRole
    tenant?: string
  } = { email, role: input.role }
  if (password !== undefined && password.length > 0) {
    payload.password = password
  }

  if (actorRole === CMS_ROLE.SUPER_ADMIN && input.role !== CMS_ROLE.SUPER_ADMIN) {
    const tenantId = input.tenantId?.trim() ?? ""
    if (tenantId.length === 0) return null
    payload["tenant"] = tenantId
  }

  return payload
}

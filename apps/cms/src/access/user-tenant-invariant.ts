import { CMS_ROLE, type CmsRole, isCmsRole } from "./roles"

const tenantIdOf = (value: unknown): string | number | null => {
  if (typeof value === "string" || typeof value === "number") {
    return value
  }
  if (typeof value === "object" && value !== null) {
    return tenantIdOf((value as Record<string, unknown>)["id"])
  }
  return null
}

export const resolvedUserRole = (incoming: unknown, existing: unknown): CmsRole | null => {
  if (isCmsRole(incoming)) {
    return incoming
  }
  return isCmsRole(existing) ? existing : null
}

export const userTenantInvariant = ({
  existingRole,
  existingTenant,
  incomingRole,
  incomingTenant,
}: {
  readonly existingRole: unknown
  readonly existingTenant: unknown
  readonly incomingRole: unknown
  readonly incomingTenant: unknown
}): { readonly role: CmsRole | null; readonly tenant: string | number | null } => {
  const role = resolvedUserRole(incomingRole, existingRole)
  const tenant = tenantIdOf(incomingTenant) ?? tenantIdOf(existingTenant)
  if (role === CMS_ROLE.SUPER_ADMIN) {
    return { role, tenant: null }
  }
  return { role, tenant }
}

export const validateUserTenantInvariant = (input: {
  readonly existingRole: unknown
  readonly existingTenant: unknown
  readonly incomingRole: unknown
  readonly incomingTenant: unknown
}): true | string => {
  const { role, tenant } = userTenantInvariant(input)
  if (role === null) {
    return "A valid role is required"
  }
  if (role !== CMS_ROLE.SUPER_ADMIN && tenant === null) {
    return "Tenant is required for every non-super-admin role"
  }
  return true
}

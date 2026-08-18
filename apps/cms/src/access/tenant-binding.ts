import { CMS_ROLE } from "./roles"
import { resolveSessionClaims, type SessionClaims, type TenantRef } from "./session"

export type TenantBindingInput = {
  readonly value: TenantRef | null
  readonly user: unknown
  readonly siblingRole: unknown
}

/**
 * Pure tenant binding decision. The client can never choose a tenant.
 *
 * - the user being written is a super-admin -> tenant is always null
 * - anonymous session -> incoming value untouched (access layer already denies)
 * - super-admin session -> its choice is respected
 * - every tenant-bound role -> forced to the session tenant
 */
export function resolveTenantBinding({
  value,
  user,
  siblingRole,
}: TenantBindingInput): TenantRef | null {
  if (siblingRole === CMS_ROLE.SUPER_ADMIN) {
    return null
  }
  const claims: SessionClaims | null = resolveSessionClaims(user)
  if (claims === null || claims.role === CMS_ROLE.SUPER_ADMIN) {
    return value
  }
  return claims.tenantId
}

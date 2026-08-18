import { CMS_ROLE, isCmsRole, type CmsRole } from "./roles"
import type { SessionClaims } from "./session"

const ASSIGNABLE_BY_TENANT_ADMIN: readonly CmsRole[] = [
  CMS_ROLE.TENANT_ADMIN,
  CMS_ROLE.EDITOR,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.CONTENT_SERVICE,
]

export type RoleAssignmentInput = {
  readonly incoming: unknown
  readonly claims: SessionClaims | null
  readonly usersEmpty: boolean
}

/**
 * Pure role assignment decision (privilege-escalation prevention).
 *
 * Returns the role to persist, or null to reject the write through the
 * required-field validation. There is intentionally no "leave untouched"
 * outcome: on a create the role is mandatory, and an update that cannot
 * assign a role must not silently keep a client-chosen value.
 *
 * - anonymous sessions: only the first-user bootstrap (empty users collection)
 *   mints exactly one super-admin
 * - super-admin sessions may assign any valid role
 * - tenant-admin sessions may assign tenant-scoped roles only
 * - every other session is denied
 */
export function resolveRoleAssignment({
  incoming,
  claims,
  usersEmpty,
}: RoleAssignmentInput): CmsRole | null {
  if (claims === null) {
    return usersEmpty ? CMS_ROLE.SUPER_ADMIN : null
  }
  const requested = typeof incoming === "string" && isCmsRole(incoming) ? incoming : null
  switch (claims.role) {
    case CMS_ROLE.SUPER_ADMIN:
      return requested
    case CMS_ROLE.TENANT_ADMIN:
      return requested !== null && ASSIGNABLE_BY_TENANT_ADMIN.includes(requested) ? requested : null
    default:
      return null
  }
}

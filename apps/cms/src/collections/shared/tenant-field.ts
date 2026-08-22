import type { RelationshipField } from "payload"

import { CMS_ROLE } from "../../access/roles"
import { forceTenantFromSession } from "../../access/tenant-field"

export type TenantFieldOptions = {
  readonly index?: boolean
  readonly managed?: boolean
  readonly required?: boolean
}

const roleOf = (user: unknown): unknown =>
  typeof user === "object" && user !== null ? (user as Record<string, unknown>)["role"] : undefined

const isSuperAdmin = (user: unknown): boolean => roleOf(user) === CMS_ROLE.SUPER_ADMIN

/**
 * Tenant is selected only by a super-admin. For every tenant-bound user the
 * authoritative value comes from forceTenantFromSession, so showing an empty
 * required relationship control would be misleading.
 */
export const tenantField = ({
  index = false,
  managed = true,
  required = true,
}: TenantFieldOptions = {}): RelationshipField => ({
  name: "tenant",
  type: "relationship",
  relationTo: "tenants",
  ...(required ? { required: true } : {}),
  ...(index ? { index: true } : {}),
  ...(managed
    ? {
        hooks: {
          beforeValidate: [forceTenantFromSession],
        },
      }
    : {}),
  admin: {
    components: {
      Cell: "/components/fields/TenantCell#TenantCell",
    },
    condition: (_, __, { user }) => isSuperAdmin(user),
  },
})

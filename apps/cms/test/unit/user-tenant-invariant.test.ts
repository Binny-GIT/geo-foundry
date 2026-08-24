import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../src/access/roles"
import {
  userTenantInvariant,
  validateUserTenantInvariant,
} from "../../src/access/user-tenant-invariant"

describe("user tenant invariant", () => {
  it("Given a super-admin, when any tenant value is provided, then the user remains cross-tenant", () => {
    expect(
      userTenantInvariant({
        existingRole: null,
        existingTenant: null,
        incomingRole: CMS_ROLE.SUPER_ADMIN,
        incomingTenant: 415,
      }),
    ).toEqual({ role: CMS_ROLE.SUPER_ADMIN, tenant: null })
  })

  it("Given a tenant-bound role, when a Tenant is selected, then its exact identity is retained", () => {
    expect(
      userTenantInvariant({
        existingRole: null,
        existingTenant: null,
        incomingRole: CMS_ROLE.TENANT_ADMIN,
        incomingTenant: { id: 415 },
      }),
    ).toEqual({ role: CMS_ROLE.TENANT_ADMIN, tenant: 415 })
  })

  it("Given an existing tenant-bound user update, when the role and Tenant are omitted, then the persisted binding remains available for validation", () => {
    expect(
      userTenantInvariant({
        existingRole: CMS_ROLE.EDITOR,
        existingTenant: 415,
        incomingRole: undefined,
        incomingTenant: undefined,
      }),
    ).toEqual({ role: CMS_ROLE.EDITOR, tenant: 415 })
  })

  it("Given a tenant-bound role without a Tenant, when validated, then the write is rejected", () => {
    expect(
      validateUserTenantInvariant({
        existingRole: null,
        existingTenant: null,
        incomingRole: CMS_ROLE.TENANT_ADMIN,
        incomingTenant: null,
      }),
    ).toBe("Tenant is required for every non-super-admin role")
  })
})

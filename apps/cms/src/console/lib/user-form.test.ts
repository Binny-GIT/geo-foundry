import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../access/roles"

import { assignableUserRoles, userFormPayload } from "./user-form"

describe("Console user form rules", () => {
  it("only exposes tenant-scoped roles to tenant-admins", () => {
    expect(assignableUserRoles(CMS_ROLE.TENANT_ADMIN)).toEqual([
      CMS_ROLE.TENANT_ADMIN,
      CMS_ROLE.EDITOR,
      CMS_ROLE.PUBLISHER,
      CMS_ROLE.REVIEWER,
      CMS_ROLE.CONTENT_SERVICE,
    ])
    expect(assignableUserRoles(CMS_ROLE.TENANT_ADMIN)).not.toContain(CMS_ROLE.SUPER_ADMIN)
  })

  it("omits tenant values from every tenant-admin payload", () => {
    expect(
      userFormPayload(CMS_ROLE.TENANT_ADMIN, {
        email: " editor@example.test ",
        role: CMS_ROLE.EDITOR,
        tenantId: "other-tenant",
      }),
    ).toEqual({
      email: "editor@example.test",
      role: CMS_ROLE.EDITOR,
    })
  })

  it("rejects a tenant-admin privilege escalation before submission", () => {
    expect(
      userFormPayload(CMS_ROLE.TENANT_ADMIN, {
        email: "admin@example.test",
        role: CMS_ROLE.SUPER_ADMIN,
        tenantId: "tenant-1",
      }),
    ).toBeNull()
  })

  it("requires a tenant only for super-admin assignments to tenant-scoped roles", () => {
    expect(
      userFormPayload(CMS_ROLE.SUPER_ADMIN, {
        email: "editor@example.test",
        role: CMS_ROLE.EDITOR,
      }),
    ).toBeNull()
    expect(
      userFormPayload(CMS_ROLE.SUPER_ADMIN, {
        email: "super@example.test",
        role: CMS_ROLE.SUPER_ADMIN,
        tenantId: "ignored-tenant",
      }),
    ).toEqual({
      email: "super@example.test",
      role: CMS_ROLE.SUPER_ADMIN,
    })
  })
})

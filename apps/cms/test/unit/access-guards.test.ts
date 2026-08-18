import { describe, expect, it } from "vitest"

import { resolveRoleAssignment } from "../../src/access/role-assignment"
import { CMS_ROLE, CMS_ROLES } from "../../src/access/roles"
import { resolveSessionClaims } from "../../src/access/session"
import { resolveTenantBinding } from "../../src/access/tenant-binding"

const claimsFor = (role: (typeof CMS_ROLES)[number], tenantId: string | number | null = 2) =>
  resolveSessionClaims({ id: 1, role, tenant: tenantId })

describe("role assignment guard (privilege escalation prevention)", () => {
  it("Given an anonymous create on an empty users collection, when resolved, then exactly one super-admin is minted regardless of the requested role", () => {
    for (const requested of [...CMS_ROLES, "hacker", undefined]) {
      expect(resolveRoleAssignment({ incoming: requested, claims: null, usersEmpty: true })).toBe(
        CMS_ROLE.SUPER_ADMIN,
      )
    }
  })

  it("Given an anonymous create on a non-empty users collection, when resolved, then the write is nulled", () => {
    expect(
      resolveRoleAssignment({ incoming: CMS_ROLE.EDITOR, claims: null, usersEmpty: false }),
    ).toBeNull()
  })

  it("Given a tenant-admin session, when super-admin is requested, then escalation is nulled and never passed through", () => {
    expect(
      resolveRoleAssignment({
        incoming: CMS_ROLE.SUPER_ADMIN,
        claims: claimsFor(CMS_ROLE.TENANT_ADMIN),
        usersEmpty: false,
      }),
    ).toBeNull()
  })

  it("Given a tenant-admin session, when a tenant-scoped role is requested, then it is allowed", () => {
    expect(
      resolveRoleAssignment({
        incoming: CMS_ROLE.PUBLISHER,
        claims: claimsFor(CMS_ROLE.TENANT_ADMIN),
        usersEmpty: false,
      }),
    ).toBe(CMS_ROLE.PUBLISHER)
  })

  it("Given an editor or reviewer session, when any role is requested, then the value is nulled", () => {
    for (const role of [
      CMS_ROLE.EDITOR,
      CMS_ROLE.REVIEWER,
      CMS_ROLE.PUBLISHER,
      CMS_ROLE.CONTENT_SERVICE,
    ]) {
      expect(
        resolveRoleAssignment({
          incoming: CMS_ROLE.TENANT_ADMIN,
          claims: claimsFor(role),
          usersEmpty: false,
        }),
      ).toBeNull()
    }
  })

  it("Given a super-admin session, when any valid role is requested, then it is assigned", () => {
    for (const requested of CMS_ROLES) {
      expect(
        resolveRoleAssignment({
          incoming: requested,
          claims: claimsFor(CMS_ROLE.SUPER_ADMIN, null),
          usersEmpty: false,
        }),
      ).toBe(requested)
    }
  })

  it("Given an invalid role value, when resolved, then it is rejected outright", () => {
    expect(
      resolveRoleAssignment({
        incoming: "hacker",
        claims: claimsFor(CMS_ROLE.TENANT_ADMIN),
        usersEmpty: false,
      }),
    ).toBeNull()
    expect(
      resolveRoleAssignment({
        incoming: 42,
        claims: claimsFor(CMS_ROLE.SUPER_ADMIN, null),
        usersEmpty: false,
      }),
    ).toBeNull()
  })
})

describe("tenant binding guard", () => {
  const user = (role: (typeof CMS_ROLES)[number], tenantId: string | number | null) => ({
    id: 1,
    role,
    tenant: tenantId,
  })

  it("Given a tenant-bound session, when a user is written, then the tenant is forced to the session tenant even if forged", () => {
    expect(
      resolveTenantBinding({
        value: 99,
        user: user(CMS_ROLE.TENANT_ADMIN, 4),
        siblingRole: CMS_ROLE.EDITOR,
      }),
    ).toBe(4)
  })

  it("Given the written user is a super-admin, when resolved, then the tenant is always null", () => {
    expect(
      resolveTenantBinding({
        value: 4,
        user: user(CMS_ROLE.SUPER_ADMIN, null),
        siblingRole: CMS_ROLE.SUPER_ADMIN,
      }),
    ).toBeNull()
  })

  it("Given a super-admin session writing a tenant-bound user, when resolved, then its choice is respected", () => {
    expect(
      resolveTenantBinding({
        value: 7,
        user: user(CMS_ROLE.SUPER_ADMIN, null),
        siblingRole: CMS_ROLE.EDITOR,
      }),
    ).toBe(7)
  })

  it("Given an anonymous session, when resolved, then the incoming value is untouched", () => {
    expect(resolveTenantBinding({ value: 7, user: null, siblingRole: CMS_ROLE.EDITOR })).toBe(7)
  })

  it("Given an editor session, when resolved, then the tenant is forced to the session tenant", () => {
    expect(
      resolveTenantBinding({
        value: null,
        user: user(CMS_ROLE.EDITOR, 5),
        siblingRole: CMS_ROLE.EDITOR,
      }),
    ).toBe(5)
  })
})

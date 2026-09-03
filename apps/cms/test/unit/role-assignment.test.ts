import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../src/access/roles"
import { resolveRoleAssignment } from "../../src/access/role-assignment"
import type { SessionClaims } from "../../src/access/session"

const claimsOf = (role: CMS_ROLE, userId = "1115"): SessionClaims => ({
  kind: "user",
  role,
  tenantId: role === CMS_ROLE.SUPER_ADMIN ? null : 413,
  userId,
})

describe("resolveRoleAssignment", () => {
  it("mints exactly the bootstrap super-admin for an anonymous empty collection", () => {
    expect(
      resolveRoleAssignment({
        claims: null,
        incoming: undefined,
        originalRole: undefined,
        originalUserId: undefined,
        usersEmpty: true,
      }),
    ).toBe(CMS_ROLE.SUPER_ADMIN)

    expect(
      resolveRoleAssignment({
        claims: null,
        incoming: CMS_ROLE.EDITOR,
        originalRole: undefined,
        originalUserId: undefined,
        usersEmpty: false,
      }),
    ).toBeNull()
  })

  it("lets super-admin and tenant-admin assign within their matrices", () => {
    const base = { originalRole: CMS_ROLE.EDITOR, originalUserId: 1115, usersEmpty: false }
    expect(
      resolveRoleAssignment({
        ...base,
        claims: claimsOf(CMS_ROLE.SUPER_ADMIN, "1"),
        incoming: CMS_ROLE.EDITOR,
      }),
    ).toBe(CMS_ROLE.EDITOR)
    expect(
      resolveRoleAssignment({
        ...base,
        claims: claimsOf(CMS_ROLE.TENANT_ADMIN, "1"),
        incoming: CMS_ROLE.REVIEWER,
      }),
    ).toBe(CMS_ROLE.REVIEWER)
    // tenant-admin cannot mint another super-admin
    expect(
      resolveRoleAssignment({
        ...base,
        claims: claimsOf(CMS_ROLE.TENANT_ADMIN, "1"),
        incoming: CMS_ROLE.SUPER_ADMIN,
      }),
    ).toBeNull()
  })

  it("denies editor self-service writes except re-asserting its own stored role", () => {
    const editor = claimsOf(CMS_ROLE.EDITOR)
    // Password change flow: same role, same document — allowed.
    expect(
      resolveRoleAssignment({
        claims: editor,
        incoming: CMS_ROLE.EDITOR,
        originalRole: CMS_ROLE.EDITOR,
        originalUserId: 1115,
        usersEmpty: false,
      }),
    ).toBe(CMS_ROLE.EDITOR)

    // Escalation attempts on the same document stay denied.
    expect(
      resolveRoleAssignment({
        claims: editor,
        incoming: CMS_ROLE.SUPER_ADMIN,
        originalRole: CMS_ROLE.EDITOR,
        originalUserId: 1115,
        usersEmpty: false,
      }),
    ).toBeNull()

    // Re-asserting a role on SOMEONE ELSE's document stays denied.
    expect(
      resolveRoleAssignment({
        claims: editor,
        incoming: CMS_ROLE.EDITOR,
        originalRole: CMS_ROLE.EDITOR,
        originalUserId: 9999,
        usersEmpty: false,
      }),
    ).toBeNull()

    // Creates (no original document) stay denied for non-admins.
    expect(
      resolveRoleAssignment({
        claims: editor,
        incoming: CMS_ROLE.EDITOR,
        originalRole: undefined,
        originalUserId: undefined,
        usersEmpty: false,
      }),
    ).toBeNull()
  })
})

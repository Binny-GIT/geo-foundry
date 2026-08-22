import { describe, expect, it } from "vitest"

import {
  CMS_ACTION,
  CMS_ACTIONS,
  CMS_RESOURCE,
  CMS_RESOURCES,
  decideAccess,
  readScope,
} from "../../src/access/policy"
import { CMS_ROLE, CMS_ROLES } from "../../src/access/roles"
import { resolveSessionClaims } from "../../src/access/session"

const claimsFor = (
  role: (typeof CMS_ROLES)[number],
  tenantId: string | number | null = "tenant-1",
  userId = "user-1",
) => resolveSessionClaims({ id: userId, role, tenant: tenantId })

describe("session claims resolution", () => {
  it("Given a tenant-bound role, when claims are resolved, then the session is scoped to its tenant", () => {
    for (const role of CMS_ROLES.filter((candidate) => candidate !== CMS_ROLE.SUPER_ADMIN)) {
      const claims = claimsFor(role, 7, "42")
      expect(claims).not.toBeNull()
      expect(claims?.tenantId).toBe(7)
      expect(claims?.userId).toBe("42")
    }
  })

  it("Given super-admin, when claims are resolved, then the session is cross-tenant without a tenant binding", () => {
    const claims = claimsFor(CMS_ROLE.SUPER_ADMIN, null)
    expect(claims?.tenantId).toBeNull()
  })

  it("Given a super-admin wrongly bound to a tenant, when claims are resolved, then the session is rejected", () => {
    expect(claimsFor(CMS_ROLE.SUPER_ADMIN, "tenant-1")).toBeNull()
  })

  it("Given a tenant-bound role without a tenant, when claims are resolved, then the session is rejected", () => {
    expect(claimsFor(CMS_ROLE.EDITOR, null)).toBeNull()
  })

  it("Given anonymous or malformed authentication, when claims are resolved, then the session is null", () => {
    expect(resolveSessionClaims(null)).toBeNull()
    expect(resolveSessionClaims({})).toBeNull()
    expect(resolveSessionClaims({ id: "u1", role: "hacker", tenant: "t1" })).toBeNull()
    expect(resolveSessionClaims({ id: "", role: CMS_ROLE.EDITOR, tenant: "t1" })).toBeNull()
    expect(resolveSessionClaims({ id: "u1", role: CMS_ROLE.EDITOR, tenant: "" })).toBeNull()
    expect(resolveSessionClaims("string")).toBeNull()
  })
})

describe("authorization matrix", () => {
  it("Given the full role x resource x action matrix, when inspected, then every combination is defined", () => {
    for (const role of CMS_ROLES) {
      for (const resource of CMS_RESOURCES) {
        for (const action of CMS_ACTIONS) {
          expect(typeof decideAccess(claimsFor(role), resource, action)).toBe("boolean")
        }
      }
    }
  })

  it("Given anonymous sessions, when any access is decided, then everything is denied", () => {
    for (const resource of CMS_RESOURCES) {
      for (const action of CMS_ACTIONS) {
        expect(decideAccess(null, resource, action)).toBe(false)
      }
    }
  })

  it("Given the plan baseline, when key permissions are checked, then they match exactly", () => {
    const editor = claimsFor(CMS_ROLE.EDITOR)
    expect(decideAccess(editor, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)).toBe(true)
    expect(decideAccess(editor, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)).toBe(true)
    expect(decideAccess(editor, CMS_RESOURCE.RELEASES, CMS_ACTION.READ)).toBe(false)

    const reviewer = claimsFor(CMS_ROLE.REVIEWER)
    expect(decideAccess(reviewer, CMS_RESOURCE.ASSESSMENTS, CMS_ACTION.READ)).toBe(true)
    expect(decideAccess(reviewer, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)).toBe(false)

    const publisher = claimsFor(CMS_ROLE.PUBLISHER)
    expect(decideAccess(publisher, CMS_RESOURCE.RELEASES, CMS_ACTION.READ)).toBe(true)
    expect(decideAccess(publisher, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)).toBe(false)

    const tenantAdmin = claimsFor(CMS_ROLE.TENANT_ADMIN)
    expect(decideAccess(tenantAdmin, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)).toBe(true)
    expect(decideAccess(tenantAdmin, CMS_RESOURCE.TENANTS, CMS_ACTION.CREATE)).toBe(false)

    const service = claimsFor(CMS_ROLE.CONTENT_SERVICE)
    expect(decideAccess(service, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)).toBe(true)
    expect(decideAccess(service, CMS_RESOURCE.ASSESSMENTS, CMS_ACTION.CREATE)).toBe(true)
    expect(decideAccess(service, CMS_RESOURCE.USERS, CMS_ACTION.READ)).toBe(false)

    const superAdmin = claimsFor(CMS_ROLE.SUPER_ADMIN, null)
    expect(decideAccess(superAdmin, CMS_RESOURCE.TENANTS, CMS_ACTION.READ)).toBe(true)
    expect(decideAccess(superAdmin, CMS_RESOURCE.TENANTS, CMS_ACTION.DELETE)).toBe(false)
  })
})

describe("read scope", () => {
  it("Given a tenant-bound reader, when scope is computed, then queries are constrained to its tenant", () => {
    const scope = readScope(claimsFor(CMS_ROLE.EDITOR, 5), CMS_RESOURCE.EDITIONS)
    expect(scope).toEqual({ tenant: { equals: 5 } })
  })

  it("Given super-admin, when scope is computed, then reads are unconstrained", () => {
    expect(readScope(claimsFor(CMS_ROLE.SUPER_ADMIN, null), CMS_RESOURCE.SITES)).toBe(true)
  })

  it("Given a denied reader, when scope is computed, then reads are false", () => {
    expect(readScope(claimsFor(CMS_ROLE.REVIEWER), CMS_RESOURCE.RELEASES)).toBe(false)
    expect(readScope(null, CMS_RESOURCE.EDITIONS)).toBe(false)
  })

  it("Given tenant reads of the tenants collection, when scope is computed, then only its own tenant row is visible", () => {
    expect(readScope(claimsFor(CMS_ROLE.TENANT_ADMIN, 9), CMS_RESOURCE.TENANTS)).toEqual({
      id: { equals: 9 },
    })
  })

  it("Given a role denied users list reads, when scope is computed, then only its own profile row is readable (admin /api/users/me)", () => {
    expect(readScope(claimsFor(CMS_ROLE.EDITOR, 5, "77"), CMS_RESOURCE.USERS)).toEqual({
      id: { equals: "77" },
    })
    expect(readScope(claimsFor(CMS_ROLE.REVIEWER, 5, "88"), CMS_RESOURCE.USERS)).toEqual({
      id: { equals: "88" },
    })
  })

  it("Given anonymous, when users scope is computed, then reads are denied", () => {
    expect(readScope(null, CMS_RESOURCE.USERS)).toBe(false)
  })

  it("Given tenant-admin, when users scope is computed, then the tenant scope (not self-only) applies", () => {
    expect(readScope(claimsFor(CMS_ROLE.TENANT_ADMIN, 9), CMS_RESOURCE.USERS)).toEqual({
      tenant: { equals: 9 },
    })
  })
})

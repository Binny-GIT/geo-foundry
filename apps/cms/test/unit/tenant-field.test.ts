import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../src/access/roles"
import { tenantField } from "../../src/collections/shared/tenant-field"

describe("tenantField", () => {
  it("Given a tenant-bound user, when admin visibility is evaluated, then the server-managed tenant field is hidden", () => {
    const field = tenantField()
    expect(field.admin?.condition?.({}, {}, { user: { role: CMS_ROLE.EDITOR } } as never)).toBe(
      false,
    )
  })

  it("Given a super-admin, when admin visibility is evaluated, then the tenant selector remains available", () => {
    const field = tenantField()
    expect(
      field.admin?.condition?.({}, {}, { user: { role: CMS_ROLE.SUPER_ADMIN } } as never),
    ).toBe(true)
  })

  it("Given collection-specific options, when the field is built, then index, required, and server binding stay explicit", () => {
    const field = tenantField({ index: true, managed: false, required: false })
    expect(field.index).toBe(true)
    expect(field.required).toBeUndefined()
    expect(field.hooks).toBeUndefined()
    expect(field.admin?.components?.Cell).toBe("/components/fields/TenantCell#TenantCell")
  })
})

import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../src/access/roles"
import { ContentEditions } from "../../src/collections/ContentEditions"
import { RollbackIntents } from "../../src/collections/RollbackIntents"
import { Sites } from "../../src/collections/Sites"
import { tenantField } from "../../src/collections/shared/tenant-field"
import { Tenants } from "../../src/collections/Tenants"
import { Users } from "../../src/collections/Users"

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
  })

  it("Given the frontend de-Payload migration, when collections are inspected, then no custom admin cell/view components remain registered", () => {
    const adminOf = (value: unknown): Record<string, unknown> =>
      (value as Record<string, unknown>)["admin"] as Record<string, unknown>
    expect(adminOf(ContentEditions)["components"]).toBeUndefined()
    expect(adminOf(RollbackIntents)["components"]).toBeUndefined()
    expect(adminOf(Sites)["components"]).toBeUndefined()
  })

  it("Given the Tenants and Users list views, when their admin configuration is inspected, then rows are scannable without opening every document", () => {
    expect(Tenants.admin?.defaultColumns).toEqual(["name", "updatedAt"])
    expect(Users.admin?.defaultColumns).toEqual(["email", "role", "tenant", "updatedAt"])
  })

  it("Given the Rollback Intents list, when its title is derived, then it uses the human-readable intent id instead of the document id", () => {
    expect(RollbackIntents.admin?.useAsTitle).toBe("intentId")
  })
})

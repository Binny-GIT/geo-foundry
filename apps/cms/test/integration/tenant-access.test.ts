import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Tenant, User } from "../../src/payload-types"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

describe("tenant access control integration", () => {
  let payload: Payload
  let tenantA: Tenant
  let tenantB: Tenant
  let superAdmin: User
  let tenantAAdmin: User
  let tenantBAdmin: User
  let tenantAEditor: User

  beforeAll(async () => {
    payload = await getPayload({ config })

    // Reset to a clean slate so the first-user bootstrap is repeatable.
    await payload.delete({ collection: "users", where: {}, overrideAccess: true })
    await payload.delete({ collection: "tenants", where: {}, overrideAccess: true })

    // First-user bootstrap: exactly one anonymous super-admin on empty users.
    // The requested role is irrelevant - the role hook forces super-admin.
    superAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User
    expect(superAdmin.role).toBe("super-admin")
    expect(superAdmin.tenant).toBeNull()

    tenantA = await payload.create({
      collection: "tenants",
      data: { name: "tenant-a-260818" },
      ...asUser(superAdmin),
    })
    tenantB = await payload.create({
      collection: "tenants",
      data: { name: "tenant-b-260818" },
      ...asUser(superAdmin),
    })

    tenantAAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-a@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantA.id,
      },
      ...asUser(superAdmin),
    })) as User
    tenantBAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-b@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantB.id,
      },
      ...asUser(superAdmin),
    })) as User
    tenantAEditor = (await payload.create({
      collection: "users",
      data: {
        email: "editor-a@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenantA.id,
      },
      ...asUser(tenantAAdmin),
    })) as User
  })

  afterAll(async () => {
    await payload.delete({ collection: "users", where: {}, overrideAccess: true })
    await payload.delete({ collection: "tenants", where: {}, overrideAccess: true })
    await payload.destroy()
  })

  it("Given a second anonymous create, when the users collection is non-empty, then it is denied", async () => {
    await expect(
      payload.create({
        collection: "users",
        data: {
          email: "intruder@geo-foundry.test",
          password: "intruder-password",
          role: "editor",
        },
        overrideAccess: false,
        depth: 0,
      }),
    ).rejects.toThrow()
  })

  it("Given a tenant-admin, when creating a user, then the tenant is forced to its own tenant even if forged", async () => {
    const created = (await payload.create({
      collection: "users",
      data: {
        email: "publisher-a@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: tenantB.id,
      },
      ...asUser(tenantAAdmin),
    })) as User
    expect(created.tenant).toBe(tenantA.id)
    await payload.delete({ collection: "users", id: created.id, overrideAccess: true })
  })

  it("Given a tenant-admin, when creating a super-admin is requested, then privilege escalation is rejected", async () => {
    await expect(
      payload.create({
        collection: "users",
        data: {
          email: "escalation@geo-foundry.test",
          password: "escalation-password",
          role: "super-admin",
          tenant: tenantA.id,
        },
        ...asUser(tenantAAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given tenant-scoped reads, when tenant A lists users, then tenant B users are invisible", async () => {
    const visible = await payload.find({
      collection: "users",
      ...asUser(tenantAAdmin),
    })
    const ids = visible.docs.map((doc) => doc.id)
    expect(ids).toContain(tenantAAdmin.id)
    expect(ids).toContain(tenantAEditor.id)
    expect(ids).not.toContain(tenantBAdmin.id)
  })

  it("Given cross-tenant ID enumeration, when tenant A targets a tenant B user id, then access is denied", async () => {
    await expect(
      payload.findByID({
        collection: "users",
        id: tenantBAdmin.id,
        ...asUser(tenantAAdmin),
      }),
    ).rejects.toThrow()
  })

  it("Given cross-tenant update, when tenant A editor targets tenant B admin, then the update is denied", async () => {
    await expect(
      payload.update({
        collection: "users",
        id: tenantBAdmin.id,
        data: { email: "hijacked@geo-foundry.test" },
        ...asUser(tenantAEditor),
      }),
    ).rejects.toThrow()
  })

  it("Given an editor, when reading users is attempted, then only the editor profile is visible", async () => {
    const visible = await payload.find({ collection: "users", ...asUser(tenantAEditor) })
    expect(visible.docs).toHaveLength(1)
    expect(visible.docs[0]?.id).toBe(tenantAEditor.id)
  })

  it("Given a reviewer, when creating users is attempted, then creation is denied", async () => {
    const reviewer = (await payload.create({
      collection: "users",
      data: {
        email: "reviewer-a@geo-foundry.test",
        password: "reviewer-password",
        role: "reviewer",
        tenant: tenantA.id,
      },
      ...asUser(tenantAAdmin),
    })) as User
    await expect(
      payload.create({
        collection: "users",
        data: {
          email: "should-not-exist@geo-foundry.test",
          password: "no-password",
          role: "editor",
          tenant: tenantA.id,
        },
        ...asUser(reviewer),
      }),
    ).rejects.toThrow()
    await payload.delete({ collection: "users", id: reviewer.id, overrideAccess: true })
  })

  it("Given anonymous reads, when any collection is queried, then access is denied", async () => {
    await expect(
      payload.find({ collection: "users", overrideAccess: false, depth: 0 }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: "tenants", overrideAccess: false, depth: 0 }),
    ).rejects.toThrow()
  })

  it("Given a tenant-admin, when reading tenants, then only its own tenant row is visible", async () => {
    const visible = await payload.find({
      collection: "tenants",
      ...asUser(tenantAAdmin),
    })
    expect(visible.docs.map((doc) => doc.id)).toEqual([tenantA.id])
  })

  it("Given the role hook passthrough risk, when a session writes an editor user, then a plain editor cannot mint any role", async () => {
    await expect(
      payload.create({
        collection: "users",
        data: {
          email: "mint@geo-foundry.test",
          password: "mint-password",
          role: "tenant-admin",
          tenant: tenantA.id,
        },
        ...asUser(tenantAEditor),
      }),
    ).rejects.toThrow()
  })
})

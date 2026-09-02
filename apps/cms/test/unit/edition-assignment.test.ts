import { describe, expect, it, vi } from "vitest"

import {
  applyEditionAssignment,
  EditionAssignmentError,
} from "../../src/services/edition-assignment"

const superAdmin = { id: 1, role: "super-admin" }
const tenantEditor = { id: 5, role: "editor", tenant: { id: 7 } }
const foreignEditor = { id: 6, role: "editor", tenant: { id: 9 } }
const reviewer = { id: 7, role: "reviewer", tenant: { id: 7 } }

const editionOf = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  site: 21,
  tenant: { id: 7 },
  workflowStatus: "draft",
  ...overrides,
})

const payloadOf = (edition: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  findByID: vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === "content-editions") return edition
    return null
  }),
  update: vi.fn(async () => ({})),
  ...extra,
})

const asPayload = (mock: unknown): never => mock as never

describe("edition assignment service", () => {
  it("rejects a reviewer despite matching tenant", async () => {
    await expect(
      applyEditionAssignment(asPayload(payload)Of(editionOf()), {
        editionId: 101,
        owner: 5,
        user: reviewer,
      }),
    ).rejects.toMatchObject({ code: "EDITION_ASSIGNMENT_FORBIDDEN" })
  })

  it("rejects an editor from another tenant", async () => {
    await expect(
      applyEditionAssignment(asPayload(payload)Of(editionOf()), {
        editionId: 101,
        owner: 5,
        user: foreignEditor,
      }),
    ).rejects.toMatchObject({ code: "EDITION_ASSIGNMENT_TENANT_MISMATCH" })
  })

  it("reassigns the owner within the same tenant", async () => {
    const payload = payloadOf(editionOf(), {
      findByID: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === "content-editions") return editionOf()
        if (collection === "users") return { id: 5, role: "publisher", tenant: { id: 7 } }
        return null
      }),
    })

    const result = await applyEditionAssignment(asPayload(payload), {
      editionId: 101,
      owner: 5,
      user: tenantEditor,
    })

    expect(result).toEqual({ editionId: 101, owner: 5 })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "content-editions",
        data: { owner: 5 },
        draft: true,
        id: 101,
        overrideAccess: true,
      }),
    )
  })

  it("clears the owner when null is passed", async () => {
    const payload = payloadOf(editionOf())

    const result = await applyEditionAssignment(asPayload(payload), {
      editionId: 101,
      owner: null,
      user: superAdmin,
    })

    expect(result).toEqual({ editionId: 101, owner: null })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { owner: null } }),
    )
  })

  it("rejects a service identity as owner", async () => {
    const payload = payloadOf(editionOf(), {
      findByID: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === "content-editions") return editionOf()
        if (collection === "users") return { id: 30, role: "content-service", tenant: { id: 7 } }
        return null
      }),
    })

    await expect(
      applyEditionAssignment(asPayload(payload), { editionId: 101, owner: 30, user: tenantEditor }),
    ).rejects.toMatchObject({ code: "EDITION_ASSIGNMENT_OWNER_INVALID" })
  })

  it("locks site reassignment once the edition is compiled", async () => {
    await expect(
      applyEditionAssignment(asPayload(payload)Of(editionOf({ workflowStatus: "compiled" })), {
        editionId: 101,
        site: 22,
        user: superAdmin,
      }),
    ).rejects.toMatchObject({ code: "EDITION_ASSIGNMENT_SITE_LOCKED" })
  })

  it("rejects a site from another tenant", async () => {
    const payload = payloadOf(editionOf(), {
      findByID: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === "content-editions") return editionOf()
        if (collection === "sites") return { id: 22, tenant: { id: 9 } }
        return null
      }),
    })

    await expect(
      applyEditionAssignment(asPayload(payload), { editionId: 101, site: 22, user: tenantEditor }),
    ).rejects.toMatchObject({ code: "EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH" })
  })

  it("reassigns the site for an in-flight edition", async () => {
    const payload = payloadOf(editionOf({ workflowStatus: "review" }), {
      findByID: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === "content-editions") return editionOf({ workflowStatus: "review" })
        if (collection === "sites") return { id: 22, tenant: { id: 7 } }
        return null
      }),
    })

    const result = await applyEditionAssignment(asPayload(payload), {
      editionId: 101,
      site: 22,
      user: tenantEditor,
    })

    expect(result).toEqual({ editionId: 101, site: 22 })
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({ data: { site: 22 } }))
  })

  it("rejects an empty patch", async () => {
    await expect(
      applyEditionAssignment(asPayload(payload)Of(editionOf()), { editionId: 101, user: superAdmin }),
    ).rejects.toBeInstanceOf(EditionAssignmentError)
  })
})

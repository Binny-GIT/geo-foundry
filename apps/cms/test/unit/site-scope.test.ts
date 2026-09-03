import { describe, expect, it } from "vitest"

import type { ConsoleSession } from "../../src/console/lib/session.server"
import { combineWhere, siteScopeWhere, sitesIdScopeWhere } from "../../src/console/lib/site-scope"

const sessionOf = (overrides: Partial<ConsoleSession>): ConsoleSession => ({
  email: "fixture@geo-foundry.test",
  id: "1",
  role: "editor",
  siteIds: null,
  tenantId: 413,
  tenantName: "fixture",
  ...overrides,
})

describe("per-user site scope", () => {
  it("keeps unrestricted sessions unfiltered", () => {
    expect(siteScopeWhere(sessionOf({ role: "super-admin", tenantId: null }))).toBeUndefined()
    expect(siteScopeWhere(sessionOf({ role: "tenant-admin" }))).toBeUndefined()
    expect(sitesIdScopeWhere(sessionOf({ role: "editor" }))).toBeUndefined()
  })

  it("narrows scoped sessions to their assigned sites", () => {
    const scoped = sessionOf({ siteIds: [7, 12] })
    expect(siteScopeWhere(scoped)).toEqual({ site: { in: [7, 12] } })
    expect(sitesIdScopeWhere(scoped)).toEqual({ id: { in: [7, 12] } })
  })

  it("combines filter conditions with the scope without dropping either", () => {
    const scoped = sessionOf({ siteIds: [7] })
    const merged = combineWhere({ workflowStatus: { equals: "review" } }, siteScopeWhere(scoped))
    expect(merged).toEqual({
      and: [{ workflowStatus: { equals: "review" } }, { site: { in: [7] } }],
    })
    expect(combineWhere(undefined, undefined)).toBeUndefined()
    expect(combineWhere({ id: { equals: 1 } }, undefined)).toEqual({ id: { equals: 1 } })
  })
})

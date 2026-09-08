import { describe, expect, it } from "vitest"

import { parseUserListQuery, USER_ROLE_OPTIONS, userListHref } from "./user-filters"

describe("User list query", () => {
  it("Given missing or malformed search params, when parsing, then it falls back to an unfiltered first page", () => {
    expect(parseUserListQuery({})).toEqual({ page: 1, q: null, role: null, tenant: null })
    expect(parseUserListQuery({ page: "0", q: "   ", role: "root", tenant: "abc" })).toEqual({
      page: 1,
      q: null,
      role: null,
      tenant: null,
    })
  })

  it("Given a known role and numeric tenant, when parsing, then both survive the whitelist", () => {
    expect(parseUserListQuery({ page: "3", q: " mark@ ", role: "editor", tenant: "413" })).toEqual({
      page: 3,
      q: "mark@",
      role: "editor",
      tenant: 413,
    })
  })

  it("Given filters, when building hrefs, then only non-default params are serialized", () => {
    expect(userListHref({ page: 1, q: null, role: null, tenant: null })).toBe(
      "/admin/collections/users",
    )
    expect(userListHref({ page: 2, q: "mark", role: "editor", tenant: 413 })).toBe(
      "/admin/collections/users?q=mark&role=editor&tenant=413&page=2",
    )
  })

  it("Given the role filter options, when rendered, then every CMS role is offered exactly once", () => {
    const keys = USER_ROLE_OPTIONS.map((option) => option.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      "super-admin",
      "tenant-admin",
      "editor",
      "reviewer",
      "publisher",
      "content-service",
    ])
  })
})

import { describe, expect, it } from "vitest"

import { consoleListHref, parseConsoleListQuery } from "./query"

describe("Console list query", () => {
  it("Given malformed URL values, when parsing list query, then it falls back to safe defaults", () => {
    expect(parseConsoleListQuery({ page: "-3", q: "   " })).toEqual({ page: 1, search: null })
    expect(parseConsoleListQuery({ page: "3.2", q: "edition" })).toEqual({
      page: 3,
      search: "edition",
    })
  })

  it("Given a list state, when generating href, then it preserves only approved query keys", () => {
    expect(
      consoleListHref({ base: "/admin/collections/sites", page: 2, search: "embed site" }),
    ).toBe("/admin/collections/sites?page=2&q=embed+site")
    expect(consoleListHref({ base: "/admin/collections/sites", page: 1, search: null })).toBe(
      "/admin/collections/sites",
    )
  })
})

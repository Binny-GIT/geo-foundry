import { describe, expect, it } from "vitest"

import {
  defaultCustomDays,
  parseWorkQuery,
  scopedWorkWhere,
  workHref,
  workWhere,
} from "./work-filters"

describe("Workbench query", () => {
  it("Given missing or malformed search params, when parsing, then it selects bounded active defaults", () => {
    expect(parseWorkQuery({})).toEqual({
      from: null,
      page: 1,
      range: "30d",
      to: null,
      view: "active",
    })
    expect(
      parseWorkQuery({
        from: "not-a-date",
        page: "-3",
        range: "custom",
        to: "2026-08-01",
        view: "unknown",
      }),
    ).toEqual({
      from: null,
      page: 1,
      range: "30d",
      to: null,
      view: "active",
    })
  })

  it("Given an explicit custom interval and all-records view, when parsing, then it preserves whitelisted values", () => {
    expect(
      parseWorkQuery({
        from: "2026-08-01",
        page: "3",
        range: "custom",
        to: "2026-08-31",
        view: "all",
      }),
    ).toEqual({
      from: "2026-08-01",
      page: 3,
      range: "custom",
      to: "2026-08-31",
      view: "all",
    })
  })

  it("Given active work, when producing where conditions, then it excludes terminal states and bounds the UTC day range", () => {
    expect(workWhere(parseWorkQuery({}), new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      and: [
        { workflowStatus: { in: ["draft", "generating", "review", "approved", "compiled"] } },
        {
          updatedAt: {
            greater_than_equal: "2026-08-03T00:00:00.000Z",
            less_than: "2026-09-02T00:00:00.000Z",
          },
        },
      ],
    })
  })

  it("Given a custom date range and site scope, when composing where conditions, then it uses the next UTC day as an exclusive upper bound", () => {
    const query = parseWorkQuery({
      from: "2026-08-20",
      range: "custom",
      to: "2026-08-22",
      view: "all",
    })
    expect(
      scopedWorkWhere(query, { site: { in: [7] } }, new Date("2026-09-01T00:00:00.000Z")),
    ).toEqual({
      and: [
        { site: { in: [7] } },
        {
          updatedAt: {
            greater_than_equal: "2026-08-20T00:00:00.000Z",
            less_than: "2026-08-23T00:00:00.000Z",
          },
        },
      ],
    })
  })

  it("Given work query changes, when generating deep links, then it preserves supported filters and omits defaults", () => {
    const query = parseWorkQuery({
      from: "2026-08-01",
      page: "2",
      range: "custom",
      to: "2026-08-31",
      view: "all",
    })
    expect(workHref(query)).toBe(
      "/admin/work?view=all&range=custom&from=2026-08-01&to=2026-08-31&page=2",
    )
    expect(workHref(query, { page: 1, range: "30d", view: "active", from: null, to: null })).toBe(
      "/admin/work",
    )
  })

  it("Given a UTC now value, when deriving default custom days, then it returns the inclusive trailing 30-day interval", () => {
    expect(defaultCustomDays(new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      from: "2026-08-03",
      to: "2026-09-01",
    })
  })
})

import { describe, expect, it } from "vitest"

import {
  ALL_WORK_COLUMNS,
  defaultCustomDays,
  parseWorkQuery,
  scopedWorkWhere,
  workHref,
  workWhere,
} from "./work-filters"

describe("Workbench query", () => {
  it("Given missing or malformed search params, when parsing, then it selects bounded defaults with all columns", () => {
    expect(parseWorkQuery({})).toEqual({
      from: null,
      owner: null,
      page: 1,
      q: null,
      range: "30d",
      showColumns: ALL_WORK_COLUMNS,
      site: null,
    })
    expect(
      parseWorkQuery({
        from: "not-a-date",
        owner: "-3",
        page: "x",
        q: "   ",
        range: "custom",
        site: "abc",
      }),
    ).toEqual({
      from: null,
      owner: null,
      page: 1,
      q: null,
      range: "30d",
      showColumns: ALL_WORK_COLUMNS,
      site: null,
    })
  })

  it("Given explicit filters, when parsing, then it preserves whitelisted values and dedupes columns", () => {
    expect(
      parseWorkQuery({
        columns: "draft,review,draft,bogus",
        from: "2026-08-01",
        owner: "7",
        page: "3",
        q: " http ",
        range: "custom",
        site: "12",
        to: "2026-08-31",
      }),
    ).toEqual({
      from: "2026-08-01",
      owner: 7,
      page: 3,
      q: "http",
      range: "custom",
      showColumns: ["draft", "review"],
      site: 12,
    })
  })

  it("Given filters, when producing where conditions, then it maps q/owner/site onto payload operators and bounds the UTC day range", () => {
    expect(workWhere(parseWorkQuery({}), new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      updatedAt: {
        greater_than_equal: "2026-08-03T00:00:00.000Z",
        less_than: "2026-09-02T00:00:00.000Z",
      },
    })
    expect(
      workWhere(
        parseWorkQuery({ owner: "7", q: "标题", site: "12" }),
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toEqual({
      and: [
        { title: { like: "标题" } },
        { owner: { equals: 7 } },
        { site: { equals: 12 } },
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
    const query = parseWorkQuery({ from: "2026-08-20", range: "custom", to: "2026-08-22" })
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
      columns: "draft,review",
      from: "2026-08-01",
      owner: "7",
      page: "2",
      q: "关键词",
      range: "custom",
      site: "12",
      to: "2026-08-31",
    })
    expect(workHref(query)).toBe(
      "/admin/work?range=custom&from=2026-08-01&to=2026-08-31&q=%E5%85%B3%E9%94%AE%E8%AF%8D&owner=7&site=12&columns=draft%2Creview&page=2",
    )
    expect(
      workHref(query, {
        from: null,
        owner: null,
        page: 1,
        q: null,
        range: "30d",
        showColumns: ALL_WORK_COLUMNS,
        site: null,
        to: null,
      }),
    ).toBe("/admin/work")
  })

  it("Given a UTC now value, when deriving default custom days, then it returns the inclusive trailing 30-day interval", () => {
    expect(defaultCustomDays(new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      from: "2026-08-03",
      to: "2026-09-01",
    })
  })
})

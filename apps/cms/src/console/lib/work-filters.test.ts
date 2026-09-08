import { describe, expect, it } from "vitest"

import {
  ALL_WORK_COLUMNS,
  defaultCustomDays,
  parseWorkQuery,
  workDateRange,
  workHref,
} from "./work-filters"

describe("Workbench query", () => {
  it("Given missing or malformed search params, when parsing, then it selects bounded defaults with all columns", () => {
    expect(parseWorkQuery({})).toEqual({
      from: null,
      owner: [],
      q: null,
      range: "30d",
      showColumns: ALL_WORK_COLUMNS,
      site: [],
      to: null,
    })
    expect(
      parseWorkQuery({
        from: "not-a-date",
        owner: "-3",
        q: "   ",
        range: "custom",
        site: "abc",
      }),
    ).toEqual({
      from: null,
      owner: [],
      q: null,
      range: "30d",
      showColumns: ALL_WORK_COLUMNS,
      site: [],
      to: null,
    })
  })

  it("Given explicit filters, when parsing, then it preserves whitelisted values and dedupes columns", () => {
    expect(
      parseWorkQuery({
        columns: "draft,review,draft,bogus",
        from: "2026-08-01",
        owner: "7",
        q: " http ",
        range: "custom",
        site: "12",
        to: "2026-08-31",
      }),
    ).toEqual({
      from: "2026-08-01",
      owner: [7],
      q: "http",
      range: "custom",
      showColumns: ["draft", "review"],
      site: [12],
      to: "2026-08-31",
    })
  })

  it("Given multiple owner/site ids, when parsing, then it dedupes and drops invalid ones from the comma list", () => {
    expect(parseWorkQuery({ owner: "7,9,7,-1,abc", site: "12,13" })).toEqual(
      expect.objectContaining({ owner: [7, 9], site: [12, 13] }),
    )
  })

  it("Given a preset range, when computing the date window, then it spans whole UTC days with an exclusive next-day upper bound", () => {
    expect(workDateRange(parseWorkQuery({}), new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      from: new Date("2026-08-03T00:00:00.000Z"),
      toExclusive: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(
      workDateRange(parseWorkQuery({ range: "today" }), new Date("2026-09-01T14:20:00.000Z")),
    ).toEqual({
      from: new Date("2026-09-01T00:00:00.000Z"),
      toExclusive: new Date("2026-09-02T00:00:00.000Z"),
    })
  })

  it("Given a custom date range, when computing the date window, then it uses the next UTC day as an exclusive upper bound", () => {
    const query = parseWorkQuery({ from: "2026-08-20", range: "custom", to: "2026-08-22" })
    expect(workDateRange(query, new Date("2026-09-01T00:00:00.000Z"))).toEqual({
      from: new Date("2026-08-20T00:00:00.000Z"),
      toExclusive: new Date("2026-08-23T00:00:00.000Z"),
    })
  })

  it("Given work query changes, when generating deep links, then it preserves supported filters and omits defaults", () => {
    const query = parseWorkQuery({
      columns: "draft,review",
      from: "2026-08-01",
      owner: "7",
      q: "关键词",
      range: "custom",
      site: "12",
      to: "2026-08-31",
    })
    expect(workHref(query)).toBe(
      "/admin/work?range=custom&from=2026-08-01&to=2026-08-31&q=%E5%85%B3%E9%94%AE%E8%AF%8D&owner=7&site=12&columns=draft%2Creview",
    )
    expect(
      workHref(query, {
        from: null,
        owner: [],
        q: null,
        range: "30d",
        showColumns: ALL_WORK_COLUMNS,
        site: [],
        to: null,
      }),
    ).toBe("/admin/work")
  })

  it("Given multiple selected owners/sites, when generating deep links, then it joins ids with commas", () => {
    const query = parseWorkQuery({ owner: "7,9", site: "12,13" })
    expect(workHref(query)).toBe("/admin/work?owner=7%2C9&site=12%2C13")
  })

  it("Given a UTC now value, when deriving default custom days, then it returns the inclusive trailing 30-day interval", () => {
    expect(defaultCustomDays(new Date("2026-09-01T14:20:00.000Z"))).toEqual({
      from: "2026-08-03",
      to: "2026-09-01",
    })
  })
})

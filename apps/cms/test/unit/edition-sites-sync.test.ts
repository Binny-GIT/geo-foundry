import { describe, expect, it } from "vitest"

import {
  activeMemberSiteIdsOf,
  compileSitePatchOf,
  desiredEditionSiteIdsOf,
  desiredSiteListOf,
} from "../../src/server/repositories/edition-sites"
import { type EditionSitesRoute, editionSitesRouteOf } from "../../src/server/routes/edition-sites"

// A1：edition_sites 目标站点集合 = {site_id} ∪ sites[]（去重、去 null）。
describe("desiredEditionSiteIdsOf", () => {
  it("unions the primary site with the sites array", () => {
    expect(desiredEditionSiteIdsOf({ siteId: 7, sites: [7, 9] })).toEqual([7, 9])
    expect(desiredEditionSiteIdsOf({ siteId: 7, sites: [8, 9] })).toEqual([7, 8, 9])
  })

  it("dedupes repeated site ids", () => {
    expect(desiredEditionSiteIdsOf({ siteId: 7, sites: [7, 7, 7] })).toEqual([7])
  })

  it("keeps only the primary when the array is empty", () => {
    expect(desiredEditionSiteIdsOf({ siteId: 7, sites: [] })).toEqual([7])
  })

  it("returns an empty set when no site is assigned", () => {
    expect(desiredEditionSiteIdsOf({ siteId: null, sites: [] })).toEqual([])
  })
})

describe("activeMemberSiteIdsOf", () => {
  it("excludes sites without a row or explicitly unpublished sites", () => {
    expect(
      activeMemberSiteIdsOf(
        [7, 8, 9],
        [
          { publishState: "pending", siteId: 7 },
          { publishState: "unpublished", siteId: 8 },
        ],
      ),
    ).toEqual([7])
  })
})

describe("compileSitePatchOf", () => {
  it("resets an already published secondary site for a new release", () => {
    expect(compileSitePatchOf({ publishState: "published", releaseId: "old" }, "new")).toEqual({
      publishState: "pending",
      publishedAt: null,
      releaseId: "new",
      urlRecordId: null,
    })
  })

  it("preserves a pending site and an idempotent published release", () => {
    expect(compileSitePatchOf({ publishState: "pending", releaseId: "old" }, "new")).toEqual({
      releaseId: "new",
    })
    expect(compileSitePatchOf({ publishState: "published", releaseId: "same" }, "same")).toEqual({
      releaseId: "same",
    })
  })
})

// A4：版本行目标站点集合的有序版本——追加/撤下站点改写 sites[] 时保持
// "主站在前的全集"不变式，主站顺延时取 [0]。
describe("desiredSiteListOf", () => {
  it("keeps the primary site first and dedupes", () => {
    expect(desiredSiteListOf({ siteId: 7, sites: [7, 9] })).toEqual([7, 9])
    expect(desiredSiteListOf({ siteId: 7, sites: [9, 7] })).toEqual([7, 9])
  })

  it("appends a missing primary-only article's sites array", () => {
    // 单站文章 sites[] 为空：目标集 = [主站]。
    expect(desiredSiteListOf({ siteId: 7, sites: [] })).toEqual([7])
    expect(desiredSiteListOf({ siteId: 7, sites: null })).toEqual([7])
  })

  it("drops the primary when it is removed and promotes the next site", () => {
    // 撤下主站 7：[0] 成为新的主站候选。
    const next = desiredSiteListOf({ siteId: 7, sites: [7, 9, 10] }).filter((id) => id !== 7)
    expect(next).toEqual([9, 10])
    expect(next[0]).toBe(9)
  })

  it("removes a non-primary site leaving the primary untouched", () => {
    expect(desiredSiteListOf({ siteId: 7, sites: [7, 9, 10] }).filter((id) => id !== 9)).toEqual([
      7, 10,
    ])
  })

  it("ignores invalid site ids", () => {
    expect(desiredSiteListOf({ siteId: -1, sites: [9] })).toEqual([9])
    expect(desiredSiteListOf({ siteId: null, sites: [] })).toEqual([])
  })
})

// A4 路由认领：POST /editions/{id}/sites（追加）与
// DELETE /editions/{id}/sites/{siteId}（撤下）。
describe("editionSitesRouteOf", () => {
  const cases: readonly [string, readonly string[], EditionSitesRoute | null][] = [
    ["POST", ["editions", "42", "sites"], "add"],
    ["DELETE", ["editions", "42", "sites", "9"], "remove"],
    ["POST", ["editions", "42", "sites", "9"], null],
    ["DELETE", ["editions", "42", "sites"], null],
    ["GET", ["editions", "42", "sites"], null],
    ["POST", ["editions", "42", "publish-operations"], null],
    ["POST", ["editions", "42"], null],
    // 非法 id 仍认领路由（handler 返回 400 EDITION_SITE_ID_INVALID，不放行 404）。
    ["POST", ["editions", "abc", "sites"], "add"],
  ]
  for (const [method, slug, expected] of cases) {
    it(`${method} /${slug.join("/")}`, () => {
      expect(editionSitesRouteOf(method, slug)).toBe(expected)
    })
  }
})

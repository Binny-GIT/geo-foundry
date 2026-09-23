import { describe, expect, it } from "vitest"

import {
  activeMemberSiteIdsOf,
  compileSitePatchOf,
  desiredEditionSiteIdsOf,
} from "../../src/server/repositories/edition-sites"

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

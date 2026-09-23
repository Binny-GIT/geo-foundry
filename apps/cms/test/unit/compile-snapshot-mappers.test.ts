import { describe, expect, it } from "vitest"

import {
  deriveRoutes,
  mapEdition,
  mediaEntriesOf,
} from "../../src/services/compile-snapshot-mappers"

describe("compile snapshot route mapping", () => {
  it("maps an active URL whose Payload relationship is depth-expanded", () => {
    const routes = deriveRoutes([
      {
        content: { id: 12 },
        pathname: "/articles/new-path",
        state: "active",
      },
      {
        pathname: "/articles/old-path",
        state: "redirected",
        targetUrl: { pathname: "/articles/new-path" },
      },
    ])

    expect(routes.activeUrlByContent.get(12)).toBe("/articles/new-path")
    expect(routes.redirects).toEqual([
      { fromPathname: "/articles/old-path", targetUrl: "/articles/new-path" },
    ])
  })

  it("maps a reserved URL (首次发布前 approved 文章的占位路径)", () => {
    const routes = deriveRoutes([
      {
        content: 77,
        pathname: "/articles/fresh-article",
        state: "reserved",
      },
      {
        content: 78,
        pathname: "/articles/living-article",
        state: "active",
      },
    ])

    expect(routes.activeUrlByContent.get(77)).toBe("/articles/fresh-article")
    expect(routes.activeUrlByContent.get(78)).toBe("/articles/living-article")
    expect(routes.redirects).toEqual([])
  })

  it("uses the content version timestamp instead of audit update time", () => {
    const edition = mapEdition({
      assessment: { inputHash: "a".repeat(64), state: "passed" },
      authorId: "author-site-12",
      authorName: "Site A Editorial Team",
      canonicalDomain: "site-a.test",
      edition: {
        body: [{ blockType: "paragraph", text: "Stable release content" }],
        content: 24,
        contentModifiedAt: "2026-08-21T00:00:00.000Z",
        createdAt: "2026-08-21T00:00:00.000Z",
        id: 42,
        primaryTopic: "Release control",
        summary: "Stable output across audit writes",
        title: "Stable release plan",
        updatedAt: "2026-08-22T00:00:00.000Z",
        workflowStatus: "approved",
      },
      media: [],
      siteKey: "site-12",
      urlPathname: "/articles/stable-release-plan",
    })

    expect(edition?.modifiedAt).toBe("2026-08-21T00:00:00.000Z")
    expect(edition?.status).toBe("published")
  })

  it("clamps a creation hook timestamp to the persisted publish timestamp", () => {
    const edition = mapEdition({
      assessment: { inputHash: "a".repeat(64), state: "passed" },
      authorId: "author-site-12",
      authorName: "Site A Editorial Team",
      canonicalDomain: "site-a.test",
      edition: {
        body: [{ blockType: "paragraph", text: "Created at database time" }],
        content: 24,
        contentModifiedAt: "2026-08-21T00:00:00.000Z",
        createdAt: "2026-08-21T00:00:00.001Z",
        id: 42,
        primaryTopic: "Release control",
        summary: "Creation clock follows the hook clock",
        title: "Creation timestamp ordering",
        updatedAt: "2026-08-22T00:00:00.000Z",
        workflowStatus: "approved",
      },
      media: [],
      siteKey: "site-12",
      urlPathname: "/articles/creation-timestamp-ordering",
    })

    expect(edition?.modifiedAt).toBe("2026-08-21T00:00:00.001Z")
    expect(edition?.publishedAt).toBe("2026-08-21T00:00:00.001Z")
  })

  it("maps a stable public author independently of the content origin enum", () => {
    const edition = mapEdition({
      assessment: { inputHash: "a".repeat(64), state: "passed" },
      authorId: "author-site-12",
      authorName: "Site A Editorial Team",
      canonicalDomain: "site-a.test",
      edition: {
        body: [{ blockType: "paragraph", text: "Stored paragraph" }],
        content: 24,
        createdAt: "2026-08-21T00:00:00.000Z",
        createdBy: "human",
        id: 42,
        primaryTopic: "Release control",
        summary: "A stable public author",
        title: "Author mapping",
        updatedAt: "2026-08-21T00:00:00.000Z",
        workflowStatus: "approved",
      },
      media: [],
      siteKey: "site-12",
      urlPathname: "/articles/author-mapping",
    })

    expect(edition?.author).toEqual({
      id: "author-site-12",
      name: "Site A Editorial Team",
      url: "https://site-a.test/authors/site-a-editorial-team",
    })
  })

  it("normalizes legacy source citations without mutating the stored edition", () => {
    const edition = mapEdition({
      assessment: { inputHash: "a".repeat(64), state: "passed" },
      authorId: "author-site-12",
      authorName: "Site A Editorial Team",
      canonicalDomain: "site-a.test",
      edition: {
        body: [{ blockType: "paragraph", text: "Stored paragraph" }],
        citations: [{ label: "Legacy source", url: "https://example.com/legacy" }],
        content: 24,
        createdAt: "2026-08-21T00:00:00.000Z",
        id: 42,
        primaryTopic: "Release control",
        summary: "Legacy citation compatibility",
        title: "Legacy citation mapping",
        updatedAt: "2026-08-21T00:00:00.000Z",
        workflowStatus: "approved",
      },
      media: [],
      siteKey: "site-12",
      urlPathname: "/articles/legacy-citation",
    })

    expect(edition?.citations).toEqual([
      {
        id: "citation-42-1",
        title: "Legacy source",
        url: "https://example.com/legacy",
      },
    ])
  })
})

describe("compile snapshot media entries", () => {
  const mediaByFilename = new Map([
    ["map.webp", { alt: "一张地图", id: 11, mimeType: "image/webp", tenantId: 413 }],
    ["chart.png", { alt: "趋势图", id: 12, mimeType: "image/png", tenantId: 413 }],
  ])

  it("builds deduped entries for geo media refs with worker transport fields", () => {
    const entries = mediaEntriesOf(
      [
        { blockType: "image", src: "/api/media/file/map.webp" },
        { blockType: "image", src: "/api/media/file/map.webp" },
        { blockType: "image", src: "/media/chart.png" },
        { blockType: "paragraph", text: "正文段落" },
      ],
      mediaByFilename,
    )

    expect(entries).toEqual([
      {
        alt: "一张地图",
        id: "11",
        mimeType: "image/webp",
        path: "/media/map.webp",
        tenantId: 413,
      },
      {
        alt: "趋势图",
        id: "12",
        mimeType: "image/png",
        path: "/media/chart.png",
        tenantId: 413,
      },
    ])
  })

  it("skips external images and refs whose media row is missing", () => {
    const entries = mediaEntriesOf(
      [
        { blockType: "image", src: "https://cdn.example.com/external.png" },
        { blockType: "image", src: "/api/media/file/deleted.webp" },
        { blockType: "image", src: "/uploads/other.png" },
      ],
      mediaByFilename,
    )

    expect(entries).toEqual([])
  })

  it("carries the media list into the mapped edition", () => {
    const entries = mediaEntriesOf(
      [{ blockType: "image", src: "/api/media/file/map.webp" }],
      mediaByFilename,
    )
    const edition = mapEdition({
      assessment: { inputHash: "a".repeat(64), state: "passed" },
      authorId: "author-site-12",
      authorName: "Site A Editorial Team",
      canonicalDomain: "site-a.test",
      edition: {
        body: [{ blockType: "image", src: "/api/media/file/map.webp" }],
        content: 24,
        contentModifiedAt: "2026-08-21T00:00:00.000Z",
        createdAt: "2026-08-21T00:00:00.000Z",
        id: 42,
        primaryTopic: "Release control",
        summary: "带图文章",
        title: "Image article",
        updatedAt: "2026-08-22T00:00:00.000Z",
        workflowStatus: "approved",
      },
      media: entries,
      siteKey: "site-12",
      urlPathname: "/articles/image-article",
    })

    expect(edition?.media).toEqual(entries)
  })
})

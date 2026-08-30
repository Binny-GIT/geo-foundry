import { describe, expect, it } from "vitest"

import { deriveRoutes, mapEdition } from "../../src/services/compile-snapshot-mappers"

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

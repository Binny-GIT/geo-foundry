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
})

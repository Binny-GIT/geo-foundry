import { describe, expect, it } from "vitest"

import { createServerDb } from "../../src/server/db/client"
import { parseEditionListQuery } from "../../src/server/routes/edition-reads"

describe("edition draft read query", () => {
  it("parses the current draft list and filter shapes", () => {
    expect(
      parseEditionListQuery(
        new URL(
          "https://example.test/api/content-editions?draft=true&depth=0&limit=20&page=2&sort=-updatedAt&where[site][equals]=374&where[tenant][equals]=413&where[workflowStatus][equals]=draft&where[title][like]=Array",
        ),
      ),
    ).toEqual({
      limit: 20,
      page: 2,
      query: "Array",
      siteId: 374,
      sort: "-updatedAt",
      status: "draft",
      tenantId: 413,
    })
  })

  it("returns null for unsupported live/depth-one/unknown filters", () => {
    expect(
      parseEditionListQuery(new URL("https://example.test/api/content-editions?depth=0")),
    ).toBeNull()
    expect(
      parseEditionListQuery(
        new URL("https://example.test/api/content-editions?draft=true&depth=1"),
      ),
    ).toBeNull()
    expect(
      parseEditionListQuery(
        new URL("https://example.test/api/content-editions?draft=true&where[owner][equals]=1"),
      ),
    ).toBeNull()
  })
})

describe("edition draft physical schema", () => {
  const db = createServerDb("postgresql://mock:mock@localhost:5432/mock")

  it("maps current draft fields to the edition_revisions columns", () => {
    const { editionVersions } = db._.fullSchema
    expect(editionVersions.bodyMarkdown.name).toBe("body_markdown")
    expect(editionVersions.workflowRevision.name).toBe("workflow_revision")
    expect(editionVersions.contentModifiedAt.name).toBe("content_modified_at")
    expect(editionVersions.versionUpdatedAt.name).toBe("edition_updated_at")
    expect(editionVersions.latest.name).toBe("latest")
  })

  it("stores secondary topics and assigned sites as array columns on both tables", () => {
    const { contentEditions, editionVersions } = db._.fullSchema
    expect(editionVersions.secondaryTopics.name).toBe("secondary_topics")
    expect(editionVersions.sites.name).toBe("sites")
    expect(contentEditions.secondaryTopics.name).toBe("secondary_topics")
    expect(contentEditions.sites.name).toBe("sites")
  })
})

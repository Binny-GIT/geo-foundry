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

  it("returns null for live/depth-one/unknown filters so Payload remains the fallback", () => {
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

  it("maps current draft fields to the latest version root columns", () => {
    const { editionVersions } = db._.fullSchema
    expect(editionVersions.bodyMarkdown.name).toBe("version_body_markdown")
    expect(editionVersions.workflowRevision.name).toBe("version_workflow_revision")
    expect(editionVersions.contentModifiedAt.name).toBe("version_content_modified_at")
    expect(editionVersions.status.name).toBe("version__status")
    expect(editionVersions.latest.name).toBe("latest")
  })

  it("maps secondary topics and assigned sites to Payload version side tables", () => {
    const { editionVersionRels, editionVersionTexts } = db._.fullSchema
    expect(editionVersionTexts.path.name).toBe("path")
    expect(editionVersionRels.siteId.name).toBe("sites_id")
  })
})

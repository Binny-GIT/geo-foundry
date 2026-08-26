import { describe, expect, it } from "vitest"

import { ContentEditions } from "../../src/collections/ContentEditions"
import { previewDocumentOf } from "../../src/components/content-edition/page-document-preview-adapter"

const editView = ContentEditions.admin?.components?.views?.edit

describe("content edition document workspace config", () => {
  it("replaces the complete stock document shell with the Geo Foundry workspace", () => {
    expect(editView).toMatchObject({
      root: {
        Component: "/components/views/ContentEditionDocument#ContentEditionDocument",
      },
    })
    expect(editView).not.toHaveProperty("default")
  })

  it("keeps preview data isolated from service-owned workflow fields", () => {
    const preview = previewDocumentOf({
      body: [{ blockType: "paragraph", text: "Preview only" }],
      editionId: 55,
      summary: "A safe draft preview.",
      title: "Preview title",
    })

    expect(preview.ok).toBe(true)
    if (!preview.ok || preview.document.pageType === "redirect") return
    expect(preview.document).not.toHaveProperty("workflowStatus")
    expect(preview.document).not.toHaveProperty("auditLog")
    expect(preview.document).not.toHaveProperty("compiledRelease")
  })
})

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("content edition unified workspace", () => {
  it("uses one Payload form workspace with source, editor, and control panes", async () => {
    const document = await sourceOf("src/components/views/ContentEditionDocument.tsx")

    expect(document).toContain("ContentEditionContextRail")
    expect(document).toContain("ContentEditionControlRail")
    expect(document).toContain("xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.55fr)_minmax(300px,0.86fr)]")
    expect(document).toContain("ContentEditionEditorCanvas")
    expect(document).toContain("ContentEditionPreview")
  })

  it("keeps the legacy Console edition route as a canonical workspace redirect", async () => {
    const route = await sourceOf("src/app/(console)/admin/(authenticated)/editions/[id]/page.tsx")

    expect(route).toContain("/admin/collections/content-editions/")
    expect(route).toContain("redirect(")
    expect(route).not.toContain("ContentEditionStudio")
  })

  it("binds workspace metadata and review controls to form-backed fields", async () => {
    const [controls, context, editor] = await Promise.all([
      sourceOf("src/components/content-edition/ContentEditionControlRail.tsx"),
      sourceOf("src/components/content-edition/ContentEditionContextRail.tsx"),
      sourceOf("src/components/content-edition/ContentEditionEditorCanvas.tsx"),
    ])

    expect(controls).toContain('path: "owner"')
    expect(controls).toContain('path: "priority"')
    expect(controls).toContain('path: "dueAt"')
    expect(controls).toContain('path: "editorialStatus"')
    expect(controls).toContain("WorkflowActions")
    expect(controls).toContain("/api/publication-plans")
    expect(controls).toContain("Publish at (UTC)")
    expect(controls).toContain("/api/editions/${id}/site-variants")
    expect(controls).toContain("/api/sites?depth=0&limit=100&sort=name")
    expect(context).toContain("article-sources")
    expect(context).toContain("review-comments")
    expect(context).toContain("ContentEditionRail")
    expect(editor).toContain("StructuredRowsField")
    expect(editor).not.toContain("JsonField")
  })
})

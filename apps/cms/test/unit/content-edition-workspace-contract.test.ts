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
    expect(document).toContain("xl:grid-cols-[minmax(240px,0.66fr)_minmax(0,1.68fr)_minmax(300px,0.8fr)]")
    expect(document).toContain("ContentEditionEditorCanvas")
    expect(document).toContain("ContentEditionPreview")
  })

  it("uses a narrow Payload bridge and keeps emergency fallback super-admin-only", async () => {
    const [legacyRoute, bridge, createBridge, emergency, workspaceLayout, emergencyLayout] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/editions/[id]/page.tsx"),
      sourceOf("src/app/(workspace)/admin/workspace/editions/[id]/page.tsx"),
      sourceOf("src/app/(workspace)/admin/workspace/editions/new/page.tsx"),
      sourceOf("src/app/(console)/admin/%5Femergency/[[...segments]]/page.tsx"),
      sourceOf("src/app/(workspace)/admin/workspace/layout.tsx"),
      sourceOf("src/app/(console)/admin/%5Femergency/[[...segments]]/layout.tsx"),
    ])

    expect(legacyRoute).toContain("/admin/workspace/editions/")
    expect(legacyRoute).toContain("redirect(")
    expect(legacyRoute).not.toContain("ContentEditionStudio")
    expect(bridge).toContain('segments: ["collections", "content-editions", id]')
    expect(bridge).toContain('requireConsoleSession(`/admin/workspace/editions/${encodeURIComponent(id)}`)')
    expect(bridge).toContain("CMS_ACTION.READ")
    expect(bridge).toContain('export const dynamic = "force-dynamic"')
    expect(createBridge).toContain('requireConsoleSession("/admin/workspace/editions/new")')
    expect(createBridge).toContain('segments: ["collections", "content-editions", "create"]')
    expect(createBridge).toContain("CMS_ACTION.CREATE")
    expect(createBridge).toContain('export const dynamic = "force-dynamic"')
    expect(emergency).toContain("requireEmergencySuperAdmin")
    expect(emergency).not.toContain("requireEmergencySession")
    for (const layout of [workspaceLayout, emergencyLayout]) {
      expect(layout).toContain('strategy="beforeInteractive"')
      expect(layout).toContain("payload-lng=zh")
      expect(layout).toContain("startsWith('payload-lng=')")
    }
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
    expect(controls).toContain("/api/publication-plan-operations")
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

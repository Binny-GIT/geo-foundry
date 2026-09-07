import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("content edition unified workspace", () => {
  it("uses one native console editor workspace with source, editor, and control panes", async () => {
    const document = await sourceOf("src/console/components/editions/EditionEditor.tsx")

    expect(document).toContain("ContentEditionAiChat")
    expect(document).toContain("ContentEditionControlRail")
    expect(document).toContain("2xl:grid-cols-[minmax(520px,1.9fr)_minmax(320px,0.9fr)]")
    expect(document).toContain("ContentEditionEditorCanvas")
    expect(document).toContain("ContentEditionPreview")
  })

  it("hosts the editor on console routes with no Payload bridge left behind", async () => {
    const [legacyRoute, editPage, createPage, emergency] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/editions/[id]/page.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/workspace/editions/[id]/page.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/workspace/editions/new/page.tsx"),
      sourceOf("src/app/(console)/admin/%5Femergency/[[...segments]]/page.tsx"),
    ])

    expect(legacyRoute).toContain("/admin/workspace/editions/")
    expect(legacyRoute).toContain("redirect(")
    // 原生页面：无 Payload RootPage/RootLayout，权限由 console 会话判定。
    for (const page of [editPage, createPage]) {
      expect(page).not.toContain("RootPage({")
      expect(page).not.toContain("@payloadcms/next/views")
      expect(page).toContain("CMS_ACTION")
      expect(page).toContain('export const dynamic = "force-dynamic"')
    }
    expect(editPage).toContain("draft: true")
    expect(editPage).toContain("EditionEditor")
    expect(createPage).toContain("doc={null}")
    // 应急入口保留 Payload 兜底且仅超管可用。
    expect(emergency).toContain("requireEmergencySuperAdmin")
  })

  it("binds workspace metadata and review controls to the native field state layer", async () => {
    const [controls, chat, editor, context] = await Promise.all([
      sourceOf("src/console/components/editions/ContentEditionControlRail.tsx"),
      sourceOf("src/console/components/editions/ContentEditionAiChat.tsx"),
      sourceOf("src/console/components/editions/ContentEditionEditorCanvas.tsx"),
      sourceOf("src/console/components/editions/edition-editor-context.tsx"),
    ])

    expect(controls).toContain('path: "owner"')
    expect(controls).toContain('path: "priority"')
    expect(controls).toContain('path: "dueAt"')
    expect(controls).toContain('path: "editorialStatus"')
    expect(controls).toContain("WorkflowActions")
    expect(controls).toContain('path: "sites"')
    expect(controls).toContain("/api/publication-plan-operations")
    expect(controls).toContain("/api/sites?depth=0&limit=100&sort=name&where[tenant][equals]=")
    expect(controls).toContain("article-sources")
    expect(controls).toContain("review-comments")
    expect(controls).toContain("ContentEditionRail")
    expect(controls).not.toContain("site-variants")
    // The assistant keeps its transcript and open state in the browser only.
    expect(chat).toContain("gf-ai-chat")
    expect(chat).toContain("localStorage")
    expect(chat).toContain("/api/editions/${editionId}/ai-chat")
    expect(editor).toContain("StructuredRowsField")
    expect(editor).not.toContain("JsonField")
    // Two body editors backed by the same block array.
    expect(editor).toContain("blocksToMarkdown")
    expect(editor).toContain("markdownToBlocks")
    expect(editor).toContain("gf-editor-mode")
    // The native state layer owns the save chain; no @payloadcms/ui import remains.
    for (const source of [controls, chat, editor, context]) {
      expect(source).not.toContain('from "@payloadcms/ui"')
    }
    expect(context).toContain('"/api/content-editions?depth=0&draft=true"')
  })
})

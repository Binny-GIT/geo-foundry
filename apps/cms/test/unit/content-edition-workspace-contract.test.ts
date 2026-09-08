import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("content edition unified workspace", () => {
  it("uses one native console editor workspace with source, editor, and control panes", async () => {
    const document = await sourceOf("src/console/features/editions/components/EditionEditor.tsx")

    expect(document).toContain("ContentEditionAiChat")
    expect(document).toContain("ContentEditionControlRail")
    expect(document).toContain("2xl:grid-cols-[minmax(520px,1.9fr)_minmax(320px,0.9fr)]")
    expect(document).toContain("ContentEditionEditorCanvas")
    expect(document).toContain("ContentEditionPreview")
  })

  it("hosts the editor on console routes with no Payload bridge left behind", async () => {
    const [legacyRoute, editPage, createPage, config] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/editions/[id]/page.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/workspace/editions/[id]/page.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/workspace/editions/new/page.tsx"),
      sourceOf("src/payload.config.ts"),
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
    expect(editPage).toContain("new EditionsRepository(serverRuntime().db)")
    expect(editPage).toContain("repository.findDraft(scope, editionId)")
    expect(editPage).toContain("repository.versionCount(scope, editionId)")
    expect(editPage).not.toContain("requireConsolePayloadContext")
    expect(createPage).toContain("requireConsoleSession")
    expect(createPage).not.toContain("requireConsolePayloadContext")
    expect(editPage).toContain("EditionEditor")
    expect(createPage).toContain("doc={null}")
    const setup = await sourceOf(
      "src/console/features/editions/components/ContentEditionSetupFields.tsx",
    )
    expect(setup).not.toContain("/api/contents")
    expect(setup).not.toContain('path: "content"')
    expect(setup).toContain("内部内容身份与租户由系统自动创建和关联")
    // Payload UI 已整体移除：无 emergency 兜底树，admin 路由指向 console 首页。
    expect(config).not.toContain("_emergency")
    expect(config).toContain('admin: "/admin"')
  })

  it("binds workspace metadata and review controls to the native field state layer", async () => {
    const [controls, chat, editor, context] = await Promise.all([
      sourceOf("src/console/features/editions/components/ContentEditionControlRail.tsx"),
      sourceOf("src/console/features/editions/ai/ContentEditionAiChat.tsx"),
      sourceOf("src/console/features/editions/components/ContentEditionEditorCanvas.tsx"),
      sourceOf("src/console/features/editions/state/edition-editor-context.tsx"),
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
    expect(chat).toContain(["/api/editions/", "$", "{editionId}", "/ai-chat"].join(""))
    expect(editor).toContain("StructuredRowsField")
    expect(editor).not.toContain("JsonField")
    // 正文编辑唯一入口是整篇 Markdown 编辑器；块编辑画布已退役。
    const markdownEditor = await sourceOf(
      "src/console/features/editions/editor/EditionMarkdownEditor.tsx",
    )
    expect(editor).not.toContain("gf-editor-mode")
    expect(editor).not.toContain("RichCanvas")
    expect(markdownEditor).toContain("useEditionBody")
    // 块视图只是派生数据：初始化兜底与派生都在原生状态层。
    expect(context).toContain("blocksToMarkdown")
    expect(context).toContain("markdownToBlocks")
    // The native state layer owns the save chain; no @payloadcms/ui import remains.
    for (const source of [controls, chat, editor, context]) {
      expect(source).not.toContain('from "@payloadcms/ui"')
    }
    expect(context).toContain('"/api/content-editions?depth=0&draft=true"')
  })
})

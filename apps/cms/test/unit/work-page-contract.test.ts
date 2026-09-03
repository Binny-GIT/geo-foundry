import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("workbench server contract", () => {
  it("uses a bounded, scoped, URL-driven content edition query", async () => {
    const [page, filters] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/work/page.tsx"),
      sourceOf("src/console/lib/work-filters.ts"),
    ])

    expect(page).toContain("parseWorkQuery")
    expect(page).toContain("scopedWorkWhere")
    expect(page).toContain('collection: "content-editions"')
    expect(page).toContain("depth: 1")
    expect(page).toContain("draft: true")
    expect(page).toContain("limit: WORK_PAGE_SIZE")
    expect(page).toContain("page: query.page")
    expect(page).toContain('sort: "-updatedAt"')
    expect(page).toContain("overrideAccess: false")
    expect(page).toContain("siteScopeWhere")
    expect(page).toContain("showColumns={query.showColumns}")
    expect(page).toContain("WorkToolbar")
    expect(page).not.toContain("limit: 200")
    expect(page).not.toContain('query.view')

    expect(filters).toContain("greater_than_equal")
    expect(filters).toContain("less_than")
    expect(filters).toContain("/admin/work")
    expect(filters).toContain("showColumns")
    expect(filters).not.toContain("ACTIVE_WORKFLOW_STATUSES")
  })

  it("keeps board scrolling contained with drag-and-drop and a bounded responsive grid", async () => {
    const [board, shell, toolbar] = await Promise.all([
      sourceOf("src/console/components/ReviewBoard.tsx"),
      sourceOf("src/console/components/ConsoleShell.tsx"),
      sourceOf("src/console/components/WorkToolbar.tsx"),
    ])

    expect(board).toContain("min-h-0 flex-1 overflow-auto")
    expect(board).toContain("2xl:grid-cols-[repeat(6,minmax(180px,1fr))]")
    expect(board).not.toContain("min-w-[1500px]")
    expect(board).toContain("dropActionFor")
    expect(board).toContain('target="_blank"')
    expect(board).toContain("showColumns")
    expect(board).toContain('draggable={false}')
    expect(shell).toContain('isWorkbench ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen"')
    expect(shell).toContain('isWorkbench && "flex min-h-0 flex-1 flex-col overflow-hidden"')

    expect(toolbar).toContain("gf-work-filters")
    expect(toolbar).toContain("localStorage")
    expect(toolbar).toContain("const [filterOpen, setFilterOpen] = useState(false)")
    expect(toolbar).toContain("FilterIcon")
    expect(toolbar).toContain("FilePlusIcon")
  })

  it("keeps the workspace three-pane responsive with container queries and a shared top bar", async () => {
    const [document, layout, topBar, canvas] = await Promise.all([
      sourceOf("src/components/views/ContentEditionDocument.tsx"),
      sourceOf("src/app/(workspace)/admin/workspace/layout.tsx"),
      sourceOf("src/components/workspace/WorkspaceTopBar.tsx"),
      sourceOf("src/components/content-edition/ContentEditionEditorCanvas.tsx"),
    ])

    expect(document).toContain(
      "2xl:grid-cols-[minmax(240px,0.7fr)_minmax(480px,1.6fr)_minmax(300px,0.8fr)]",
    )
    expect(document).toContain("@container")
    expect(layout).toContain("WorkspaceTopBar")
    expect(layout).toContain("requireConsoleSession")
    expect(topBar).toContain("账户设置（修改密码）")
    expect(topBar).toContain("退出登录")
    expect(canvas).toContain("@min-[520px]:grid-cols-2")
  })
})

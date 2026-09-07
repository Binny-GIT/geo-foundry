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
    expect(page).toContain("limit: WORK_QUERY_LIMIT")
    expect(page).toContain('sort: "-updatedAt"')
    expect(page).toContain("overrideAccess: false")
    expect(page).toContain("siteScopeWhere")
    expect(page).toContain("showColumns={query.showColumns}")
    expect(page).toContain("WorkToolbar")
    expect(page).not.toContain("limit: 200")
    expect(page).not.toContain("query.view")
    // The board groups a flat query into six status columns, so a global
    // "page 2 of N" control makes no sense against it (see WORK_QUERY_LIMIT's
    // comment) — no pagination UI, only a truncation notice when it fires.
    expect(page).not.toContain("上一页")
    expect(page).not.toContain("下一页")
    expect(page).toContain("hiddenCount > 0")

    expect(filters).toContain("greater_than_equal")
    expect(filters).toContain("less_than")
    expect(filters).toContain('"90d"')
    expect(filters).toContain('"180d"')
    expect(filters).toContain("近 3 个月")
    expect(filters).toContain("近半年")
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
    expect(board).toContain("draggable={false}")
    expect(shell).toContain('isWorkbench ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen"')
    expect(shell).toContain('isWorkbench && "flex min-h-0 flex-1 flex-col overflow-hidden"')

    expect(toolbar).toContain("gf-work-filters")
    expect(toolbar).toContain("localStorage")
    expect(toolbar).toContain("const [filterOpen, setFilterOpen] = useState(false)")
    expect(toolbar).toContain("FilterIcon")
    expect(toolbar).toContain("FilePlusIcon")
  })

  it("renders card workflow actions as icon-only buttons with hover tooltips, secondary left / primary right", async () => {
    const board = await sourceOf("src/console/components/ReviewBoard.tsx")

    // Icon-only: no bare action.label text node next to the icon, and every
    // button carries both a native tooltip (title) and an accessible name
    // (aria-label) since there is no visible text left to announce it.
    expect(board).toContain("aria-label={action.label}")
    expect(board).toContain("title={action.label}")
    expect(board).toContain("<action.icon size={13} />")
    expect(board).toContain('size="icon-xs"')
    // The old rendering fell back to the visible label text; icon-only mode
    // never does — pending state shows an ellipsis glyph instead.
    expect(board).not.toContain(": action.label}")

    // Secondary (reverse/reject) actions sit left, primary (forward) actions
    // sit right — justify-between keeps a lone side pinned to its edge.
    expect(board).toContain('action.tone === "secondary"')
    expect(board).toContain('action.tone === "primary"')
    expect(board).toContain("flex min-w-0 items-center justify-between gap-1.5")
  })

  it("keeps the workspace three-pane responsive with container queries and a shared top bar", async () => {
    const [document, layout, topBar, canvas] = await Promise.all([
      sourceOf("src/components/views/ContentEditionDocument.tsx"),
      sourceOf("src/app/(workspace)/admin/workspace/layout.tsx"),
      sourceOf("src/components/workspace/WorkspaceTopBar.tsx"),
      sourceOf("src/components/content-edition/ContentEditionEditorCanvas.tsx"),
    ])

    // The assistant owns a sticky full-height column; canvas and rail share
    // the rest of the width.
    expect(document).toContain("xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)]")
    expect(document).toContain("2xl:grid-cols-[minmax(520px,1.9fr)_minmax(320px,0.9fr)]")
    expect(document).toContain("@container")
    // The sticky editor column is measured against the 56px workspace top bar.
    expect(layout).toContain("WorkspaceTopBar")
    expect(layout).toContain("requireConsoleSession")
    expect(topBar).toContain("退出登录")
    expect(canvas).toContain("@min-[520px]:grid-cols-2")
  })
})

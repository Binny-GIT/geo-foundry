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
    expect(page).toContain('showTerminalColumns={query.view === "all"}')
    expect(page).not.toContain("limit: 200")

    expect(filters).toContain("ACTIVE_WORKFLOW_STATUSES")
    expect(filters).toContain("greater_than_equal")
    expect(filters).toContain("less_than")
    expect(filters).toContain("/admin/work")
  })

  it("keeps board scrolling contained and makes its grid responsive", async () => {
    const [board, shell] = await Promise.all([
      sourceOf("src/console/components/ReviewBoard.tsx"),
      sourceOf("src/console/components/ConsoleShell.tsx"),
    ])

    expect(board).toContain("min-h-0 flex-1 overflow-auto")
    expect(board).toContain("sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6")
    expect(board).not.toContain("min-w-[1500px]")
    expect(shell).toContain('isWorkbench ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen"')
    expect(shell).toContain('isWorkbench && "flex min-h-0 flex-1 flex-col overflow-hidden"')
  })
})

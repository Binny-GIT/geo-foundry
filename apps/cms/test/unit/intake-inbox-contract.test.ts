import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("intake inbox URL import", () => {
  it("keeps URL intake creation in the Console while delegating fetch safety to the existing endpoint", async () => {
    const [inbox, endpoint] = await Promise.all([
      sourceOf("src/console/components/IntakeInbox.tsx"),
      sourceOf("src/endpoints/intake.ts"),
    ])

    expect(inbox).toContain("导入公开 URL")
    expect(inbox).toContain('name="sourceUrl"')
    expect(inbox).toContain('name="suggestedSiteId"')
    expect(inbox).toContain('channel: "url"')
    expect(inbox).toContain('fetch("/api/intake-operations"')
    expect(inbox).toContain("canManage &&")
    expect(endpoint).toContain('path: "/intake-operations"')
    expect(endpoint).toContain("scheduleIntakeFetch")
  })
})

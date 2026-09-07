import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = async (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("admin navigation contract", () => {
  it("renders the unified nav from the shared console registry in ConsoleShell", async () => {
    const [shell, registry] = await Promise.all([
      sourceOf("src/console/components/ConsoleShell.tsx"),
      sourceOf("src/console/lib/resources.ts"),
    ])

    expect(shell).toContain("CONSOLE_NAV")
    expect(shell).toContain("CONSOLE_NAV.business")
    expect(shell).toContain("CONSOLE_NAV.admin")

    expect(registry).toContain('href: "/admin"')
    expect(registry).toContain('href: "/admin/work"')
    expect(registry).toContain('{ kind: "resource", slug: "content-editions" }')
    expect(registry).toContain('{ kind: "resource", slug: "sites" }')
  })

  it("keeps the Payload config free of custom admin UI registrations after the frontend de-Payload migration", async () => {
    const [config, importMap] = await Promise.all([
      sourceOf("src/payload.config.ts"),
      sourceOf("src/app/(payload)/admin/importMap.ts"),
    ])

    // 前端已去 Payload：config 不得再注册自定义组件视图/导航/图形。
    expect(config).not.toContain("beforeLogin")
    expect(config).not.toContain("Nav:")
    expect(config).not.toContain("dashboard")
    expect(config).not.toContain("workQueue")
    // importMap 只允许 Payload 自身必需的客户端组件（S3 上传、集合卡片）。
    expect(importMap).not.toContain("../../../components/")
    expect(importMap).not.toContain("/components/nav")
    expect(importMap).not.toContain("/components/views")
  })
})

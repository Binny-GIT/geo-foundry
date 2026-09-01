import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = async (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("admin navigation contract", () => {
  it("renders the unified nav from the shared console registry", async () => {
    const [navigation, registry] = await Promise.all([
      sourceOf("src/components/nav/NavLinks.tsx"),
      sourceOf("src/console/lib/resources.ts"),
    ])

    expect(navigation).toContain("CONSOLE_NAV")
    expect(navigation).toContain("CONSOLE_NAV.business")
    expect(navigation).toContain("CONSOLE_NAV.admin")
    expect(navigation).not.toContain("/history/releases")
    expect(navigation).not.toContain("`${adminRoute}/tenant`")
    expect(navigation).not.toContain("`${adminRoute}/system/diagnostics`")

    expect(registry).toContain('href: "/admin"')
    expect(registry).toContain('href: "/admin/work"')
    expect(registry).toContain('{ kind: "resource", slug: "content-editions" }')
    expect(registry).toContain('{ kind: "resource", slug: "sites" }')
  })

  it("does not register removed release, tenant, or diagnostics custom routes", async () => {
    const config = await sourceOf("src/payload.config.ts")

    expect(config).not.toContain('path: "/history/releases"')
    expect(config).not.toContain('path: "/tenant"')
    expect(config).not.toContain('path: "/system/diagnostics"')
    expect(config).toContain('path: "/work"')
    expect(config).toContain('path: "/work/editions/:id"')
  })
})

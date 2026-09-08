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

  it("serves every API route from the self-built gateway with no Payload runtime left", async () => {
    const gateway = await sourceOf("src/app/(api)/api/[...slug]/route.ts")

    expect(gateway).not.toContain("@payloadcms")
    expect(gateway).not.toContain("@payload-config")
    expect(gateway).toContain("handleInternalRequest")
    expect(gateway).toContain("return handled ?? notFound()")
  })
})

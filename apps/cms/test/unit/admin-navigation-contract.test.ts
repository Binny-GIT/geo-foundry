import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = async (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("admin navigation contract", () => {
  it("keeps Dashboard and role work queues while removing obsolete workspace destinations", async () => {
    const navigation = await sourceOf("src/components/nav/NavLinks.tsx")

    expect(navigation).toContain('id="nav-dashboard"')
    expect(navigation).toContain('`${adminRoute}/work`')
    expect(navigation).not.toContain("/history/releases")
    expect(navigation).not.toContain("`${adminRoute}/tenant`")
    expect(navigation).not.toContain("`${adminRoute}/system/diagnostics`")
  })

  it("does not register removed release, tenant, or diagnostics custom routes", async () => {
    const config = await sourceOf("src/payload.config.ts")

    expect(config).not.toContain('path: "/history/releases"')
    expect(config).not.toContain('path: "/tenant"')
    expect(config).not.toContain('path: "/system/diagnostics"')
    expect(config).toContain('path: "/work"')
  })
})

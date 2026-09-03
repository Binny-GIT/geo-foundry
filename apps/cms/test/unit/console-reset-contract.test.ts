import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

/*
 * The console stylesheet cannot ship Tailwind's real preflight (the Payload
 * admin tree shares this build), so @layer base in console.css is the one
 * global control sheet that erases native defaults for .gf-console instead.
 * This contract keeps future edits from shrinking it back into piecemeal
 * patches (user direction 2026-09-03: underlined links and other UA styles
 * kept resurfacing one surface at a time).
 */
describe("scoped preflight contract", () => {
  it("keeps a universal native-style reset inside @layer base", async () => {
    const css = await sourceOf("src/app/(console)/console.css")

    // Universal box reset mirrors the official Tailwind v4 preflight.
    expect(css).toContain(".gf-console *,\n  .gf-console *::before,\n  .gf-console *::after {")
    expect(css).toContain("border: 0 solid;\n    margin: 0;\n    padding: 0;")

    // Links never carry the UA underline or color inside the console.
    expect(css).toContain(".gf-console a {\n    color: inherit;\n    text-decoration: none;\n  }")

    // Layout lists lose their native markers; editorial body lists opt back
    // in with list-disc utilities, which outrank this layer.
    expect(css).toContain(".gf-console ul,\n  .gf-console ol {\n    list-style: none;\n  }")

    // Media, form-control typography, and native button chrome.
    expect(css).toContain(".gf-console img,\n  .gf-console svg,\n  .gf-console video {")
    expect(css).toContain("height: auto;\n    max-width: 100%;")
    expect(css).toContain("font: inherit;")
    expect(css).toContain("background-color: transparent;")

    // The preflight lives in @layer base so unlayered Tailwind utilities
    // (border variants, font-medium, hover:underline on link buttons,
    // list-disc) always outrank it.
    expect(css.indexOf("@layer base {")).toBeGreaterThan(0)
  })

  it("folds the former piecemeal patches into the preflight", async () => {
    const css = await sourceOf("src/app/(console)/console.css")

    expect(css).not.toContain('a:not([data-slot="button"])')
    expect(css).not.toContain('a[data-slot="button"] {\n  text-decoration: none;')
    expect(css).not.toContain("@layer base {\n  .gf-console button {\n    border: 0;")
    expect(css).not.toContain("button:not([data-slot=")
  })

  it("erases underlined links across the payload admin tree as well", async () => {
    const [theme, rail, sites, ops, release, tenant] = await Promise.all([
      sourceOf("src/app/(payload)/admin-theme.css"),
      sourceOf("src/components/content-edition/ContentEditionContextRail.tsx"),
      sourceOf("src/components/sites/SitesOperationsWorkspace.tsx"),
      sourceOf("src/components/dashboard/OperationsDashboard.tsx"),
      sourceOf("src/components/views/ReleaseHistory.tsx"),
      sourceOf("src/components/views/TenantWorkspace.tsx"),
    ])

    // Body-preview links keep their accent color but drop the UA underline.
    const previewLink = theme.slice(
      theme.indexOf(".gf-edition-preview a {"),
      theme.indexOf(".gf-edition-preview a {") + 200,
    )
    expect(previewLink).toContain("text-decoration: none;")

    // Hover feedback stays color-only on every custom admin surface; the
    // intake sourceUrl link carries no-underline for its resting state too.
    expect(theme).not.toContain("text-decoration: underline")
    for (const source of [rail, sites, ops, release, tenant]) {
      expect(source).not.toContain("hover:underline")
    }
    expect(rail).toContain("no-underline hover:text-[var(--gf-accent-400)]")
  })

  it("keeps payload list-cell links safe outside the table stylesheet scope", async () => {
    const cells = await Promise.all([
      sourceOf("src/components/fields/EditionCell.tsx"),
      sourceOf("src/components/fields/SiteCell.tsx"),
      sourceOf("src/components/fields/TenantCell.tsx"),
    ])
    for (const cell of cells) {
      expect(cell).toContain('className="no-underline"')
    }
  })
})

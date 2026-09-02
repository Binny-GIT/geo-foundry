import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("console button and link style contract", () => {
  it("keeps shadcn Button links free of browser underlines and preserves variant foregrounds", async () => {
    const [button, consoleCss] = await Promise.all([
      sourceOf("src/components/ui/button.tsx"),
      sourceOf("src/app/(console)/console.css"),
    ])

    expect(button).toContain("no-underline")
    expect(button).toContain('data-slot="button"')
    expect(consoleCss).toContain('.gf-console a[data-slot="button"] {\n  text-decoration: none;')
    expect(consoleCss).toContain('.gf-console a:not([data-slot="button"])')
    expect(consoleCss).not.toContain(".gf-console a {\n  text-decoration")
  })

  it("mirrors the official shadcn v4 button spec with theme tokens", async () => {
    const [button, consoleCss, login, panel] = await Promise.all([
      sourceOf("src/components/ui/button.tsx"),
      sourceOf("src/app/(console)/console.css"),
      sourceOf("src/console/components/ConsoleLoginForm.tsx"),
      sourceOf("src/console/components/ArticleWorkflowPanel.tsx"),
    ])

    // Official v4 spec: rounded-md, font-medium, 3px focus ring, svg padding.
    expect(button).toContain("rounded-md text-sm font-medium")
    // Focus ring via outline width+offset+color: three distinct tailwind-merge
    // groups, so cn() cannot collapse one away like dual ring-[...] classes.
    expect(button).toContain("focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gf-btn-ring")
    expect(button).toContain("has-[>svg]:px-3")
    expect(button).toContain('lg: "h-10 rounded-md px-6 has-[>svg]:px-4"')
    expect(button).toContain('data-variant={variant}')
    expect(button).toContain("destructive")
    expect(button).toContain("outline")
    expect(button).toContain("link:")

    // Token-driven colors; no cheap hairline secondary, no bright overrides.
    expect(button).toContain("var(--gf-btn-primary,#6366f1)")
    expect(button).not.toContain("border-slate-200")
    expect(consoleCss).toContain("--gf-btn-ring: rgb(99 102 241 / 50%);")
    expect(consoleCss).toContain("--gf-btn-destructive: #dc2626;")

    // No per-page glow overrides; auxiliary comment stays secondary.
    expect(login).not.toContain("shadow-lg")
    expect(login).not.toContain("h-11 w-full")
    const commentButton = panel.slice(panel.indexOf("提交评论") - 700, panel.indexOf("提交评论"))
    expect(commentButton).toContain('variant="secondary"')

    // Console form controls share the button radius.
    const editions = await sourceOf("src/console/components/EditionsWorkspace.tsx")
    expect(editions).toContain("rounded-md border border-[var(--console-border)]")
  })

  it("uses shadcn buttons for Console navigation actions and keeps entity links understated", async () => {
    const [editions, sites, article, collections, plans] = await Promise.all([
      sourceOf("src/console/components/EditionsWorkspace.tsx"),
      sourceOf("src/console/components/SitesWorkspace.tsx"),
      sourceOf("src/console/components/ArticleDetail.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/collections/[slug]/page.tsx"),
      sourceOf("src/console/components/PublicationPlansWorkspace.tsx"),
    ])

    for (const source of [editions, sites, article, collections, plans]) {
      expect(source).toContain("Button")
      expect(source).not.toContain("hover:underline")
    }

    expect(editions).toContain('variant="secondary"')
    expect(sites).toContain('variant="secondary"')
    expect(plans).toContain('variant={view === "day" ? "default" : "secondary"}')
    expect(article).toContain("hover:text-[var(--console-accent)]")
  })

  it("renders terminal pagination controls as real disabled buttons instead of disabled-looking links", async () => {
    const [work, editions, sites, collections] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/work/page.tsx"),
      sourceOf("src/console/components/EditionsWorkspace.tsx"),
      sourceOf("src/console/components/SitesWorkspace.tsx"),
      sourceOf("src/app/(console)/admin/(authenticated)/collections/[slug]/page.tsx"),
    ])

    for (const source of [work, editions, sites, collections]) {
      expect(source).toContain("<Button disabled")
      expect(source).not.toContain("aria-disabled")
    }
  })

  it("places the morphing desktop collapse controls at the lower-right side of both nav shells", async () => {
    const [consoleShell, payloadNav] = await Promise.all([
      sourceOf("src/console/components/ConsoleShell.tsx"),
      sourceOf("src/components/nav/NavLinks.tsx"),
    ])

    expect(consoleShell).toContain("hidden shrink-0 justify-end border-t border-white/10")
    expect(consoleShell).toContain("lg:justify-center")
    expect(consoleShell).toContain("icon={collapsed ? PanelLeftOpen : PanelLeftClose}")
    expect(consoleShell.indexOf('aria-label={collapsed ? "展开导航" : "收起导航"}')).toBeGreaterThan(
      consoleShell.indexOf("</nav>"),
    )

    expect(payloadNav).toContain("hidden shrink-0 justify-end border-t border-white/10")
    expect(payloadNav).toContain("min-[1441px]:justify-center")
    expect(payloadNav).toContain("icon={collapsed ? PanelLeftOpen : PanelLeftClose}")
    // Format-agnostic: the bilingual label may wrap across lines, so anchor on
    // the label text itself rather than the exact JSX one-liner.
    expect(payloadNav.indexOf('"展开导航"')).toBeGreaterThan(payloadNav.lastIndexOf("LogOutIcon"))
  })
})

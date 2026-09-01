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
    expect(payloadNav.indexOf('aria-label={collapsed ? (isZH ? "展开导航"')).toBeGreaterThan(
      payloadNav.lastIndexOf("LogOutIcon"),
    )
  })
})

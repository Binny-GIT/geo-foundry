import { describe, expect, it } from "vitest"

import {
  CONSOLE_NAV,
  CONSOLE_RESOURCES,
  VISIBLE_RESOURCE_SLUGS,
} from "../../src/console/lib/resources"

describe("Console navigation contract", () => {
  it("organizes the sidebar around the operator pipeline, not collection tables", () => {
    const navSlugs = [...CONSOLE_NAV.business, ...CONSOLE_NAV.admin].flatMap((item) =>
      item.kind === "resource" ? [item.slug] : [],
    )
    expect(navSlugs).toEqual(["content-editions", "sites", "users", "operations", "media"])
  })

  it("leads with the console and workbench, then registry resources", () => {
    expect(CONSOLE_NAV.business[0]).toMatchObject({ href: "/admin", kind: "static" })
    expect(CONSOLE_NAV.business[1]).toMatchObject({ href: "/admin/work", kind: "static" })
  })

  it("uses business language for renamed registry entries", () => {
    expect(CONSOLE_RESOURCES.users.label.zh).toBe("系统用户管理")
    expect(CONSOLE_RESOURCES.operations.label.zh).toBe("操作日志")
    expect(CONSOLE_RESOURCES.media.label.zh).toBe("OSS存储")
    expect(CONSOLE_RESOURCES["content-editions"].label.zh).toBe("文章列表")
    expect(CONSOLE_RESOURCES.sites.label.zh).toBe("站点列表")
    expect(CONSOLE_RESOURCES["performance-snapshots"].label.zh).toBe("流量统计")
  })

  it("keeps ledger and config routes reachable outside the sidebar", () => {
    const offNavSlugs = [
      "domains",
      "url-records",
      "quality-assessments",
      "releases",
      "rollback-intents",
      "performance-snapshots",
      "contents",
      "tenants",
      "publication-plans",
    ] as const
    for (const slug of offNavSlugs) {
      expect(VISIBLE_RESOURCE_SLUGS).toContain(slug)
      expect(
        [...CONSOLE_NAV.business, ...CONSOLE_NAV.admin].some(
          (item) => item.kind === "resource" && item.slug === slug,
        ),
      ).toBe(false)
    }
  })
})

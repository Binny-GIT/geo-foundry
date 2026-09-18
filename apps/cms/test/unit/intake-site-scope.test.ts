/*
 * 投稿站点校验前移的纯决策测试：suggestedSiteId 指向的站点行缺失或
 * 租户不符时，投稿在入口即拒（数据库查询由 E2E 覆盖）。此前这道
 * 校验只在人工采纳时兜底，跨租户站点 id 能躺进稿源箱。
 */

import { describe, expect, it } from "vitest"

import { intakeSiteScopeErrorOf } from "../../src/server/routes/intake-ops"

describe("intake suggestedSiteId scope check", () => {
  it("Given a site row whose tenant matches the submission tenant, when checked, then it passes", () => {
    expect(intakeSiteScopeErrorOf(413, 413)).toBeNull()
  })

  it("Given no site row at all, when checked, then it fails with INTAKE_SITE_NOT_FOUND", () => {
    expect(intakeSiteScopeErrorOf(undefined, 413)).toBe("INTAKE_SITE_NOT_FOUND")
  })

  it("Given a site row belonging to another tenant, when checked, then it fails with INTAKE_SITE_TENANT_MISMATCH", () => {
    expect(intakeSiteScopeErrorOf(414, 413)).toBe("INTAKE_SITE_TENANT_MISMATCH")
  })
})

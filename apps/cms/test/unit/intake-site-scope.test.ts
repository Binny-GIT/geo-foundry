/*
 * 投稿站点链路的纯决策测试：入口站点校验（suggestedSiteId 缺行/跨租户
 * 即拒，数据库查询由 E2E 覆盖）、站点来源优先级（payload 显式值 >
 * 密钥默认站点）、以及 webhook 自动成稿的触发条件（缺一即回落收件箱）。
 */

import { describe, expect, it } from "vitest"

import {
  intakeSiteScopeErrorOf,
  resolveSuggestedSiteId,
  shouldAutoAdopt,
} from "../../src/server/routes/intake-ops"

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

describe("intake suggestedSiteId resolution precedence", () => {
  it("Given an explicit payload site id, when resolved, then it wins over the credential default", () => {
    expect(resolveSuggestedSiteId(375, 374)).toBe(375)
  })

  it("Given no payload site id but a credential default, when resolved, then the default applies", () => {
    expect(resolveSuggestedSiteId(undefined, 374)).toBe(374)
  })

  it("Given neither payload site id nor credential default, when resolved, then it stays undefined for channel rules to decide", () => {
    expect(resolveSuggestedSiteId(undefined, null)).toBeUndefined()
  })
})

describe("webhook auto-adopt trigger conditions", () => {
  const base = {
    autoAdopt: true,
    directDrop: true,
    duplicate: false,
    replay: false,
    resolvedSiteId: 374 as number | undefined,
  }

  it("Given all conditions met, when checked, then auto-adopt triggers", () => {
    expect(shouldAutoAdopt(base)).toBe(true)
  })

  it("Given a credential without autoAdopt, when checked, then it stays in the inbox", () => {
    expect(shouldAutoAdopt({ ...base, autoAdopt: false })).toBe(false)
  })

  it("Given an idempotency replay, when checked, then no second article is created", () => {
    expect(shouldAutoAdopt({ ...base, replay: true })).toBe(false)
  })

  it("Given a duplicate submission, when checked, then it is not adopted again", () => {
    expect(shouldAutoAdopt({ ...base, duplicate: true })).toBe(false)
  })

  it("Given no resolved site, when checked, then auto-adopt does not trigger", () => {
    expect(shouldAutoAdopt({ ...base, resolvedSiteId: undefined })).toBe(false)
  })

  it("Given a non-direct channel (url/rss), when checked, then it goes through the inbox", () => {
    expect(shouldAutoAdopt({ ...base, directDrop: false })).toBe(false)
  })
})

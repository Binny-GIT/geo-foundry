import { describe, expect, it } from "vitest"

import { publishCreatorAuthorized } from "../../src/server/repositories/release-registry"

// 发布回执段创建者授权规则（2026-09-23 Mark 定调：publisher / super-admin
// 不区分）：super-admin 跨租户放行；publisher 必须与文章同租户。
describe("publishCreatorAuthorized", () => {
  it("allows a same-tenant publisher", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "publisher",
        creatorTenant: 413,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(true)
  })

  it("rejects a publisher from another tenant", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "publisher",
        creatorTenant: 414,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(false)
  })

  it("rejects a publisher without tenant binding", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "publisher",
        creatorTenant: null,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(false)
  })

  it("allows a super-admin regardless of the edition tenant", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "super-admin",
        creatorTenant: null,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(true)
  })

  it("rejects other human roles", () => {
    for (const role of ["editor", "reviewer", "tenant-admin"]) {
      expect(
        publishCreatorAuthorized({
          creatorRole: role,
          creatorTenant: 413,
          editionTenantId: 413,
          operationType: "publish",
        }),
      ).toBe(false)
    }
  })

  it("rejects service identities and unknown roles", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "content-service",
        creatorTenant: 413,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(false)
    expect(
      publishCreatorAuthorized({
        creatorRole: undefined,
        creatorTenant: 413,
        editionTenantId: 413,
        operationType: "publish",
      }),
    ).toBe(false)
  })

  it("rejects non-publish operation types", () => {
    expect(
      publishCreatorAuthorized({
        creatorRole: "publisher",
        creatorTenant: 413,
        editionTenantId: 413,
        operationType: "rollback",
      }),
    ).toBe(false)
  })
})

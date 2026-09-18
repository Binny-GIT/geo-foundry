/*
 * Public RSS 投稿的 connector 入口校验：不存在、跨租户、类型不符或停用
 * 都在入稿源箱前拒绝；Worker 侧仍保留同款校验作为纵深防御。
 */

import { describe, expect, it } from "vitest"

import { intakeConnectorErrorOf } from "../../src/server/routes/intake-ops"

describe("intake RSS connector scope check", () => {
  it("accepts an active RSS connector from the submission tenant", () => {
    expect(intakeConnectorErrorOf({ status: "active", tenantId: 413, type: "rss" }, 413)).toBeNull()
  })

  it("rejects a missing connector before the intake row is created", () => {
    expect(intakeConnectorErrorOf(undefined, 413)).toBe("INTAKE_CONNECTOR_NOT_FOUND")
  })

  it("rejects a connector owned by another tenant with a dedicated 403 code", () => {
    expect(intakeConnectorErrorOf({ status: "active", tenantId: 414, type: "rss" }, 413)).toBe(
      "INTAKE_CONNECTOR_TENANT_MISMATCH",
    )
  })

  it("rejects a non-RSS connector", () => {
    expect(intakeConnectorErrorOf({ status: "active", tenantId: 413, type: "webhook" }, 413)).toBe(
      "INTAKE_CONNECTOR_INVALID",
    )
  })

  it("rejects a disabled RSS connector", () => {
    expect(intakeConnectorErrorOf({ status: "disabled", tenantId: 413, type: "rss" }, 413)).toBe(
      "INTAKE_CONNECTOR_INVALID",
    )
  })
})

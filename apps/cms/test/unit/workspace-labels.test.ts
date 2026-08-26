import { describe, expect, it } from "vitest"

import {
  assessmentStateLabel,
  operationStateLabel,
  operationTypeLabel,
  releaseStateLabel,
  roleLabel,
  siteStatusLabel,
} from "../../src/components/workspaces/workspace-labels"

describe("workspace labels", () => {
  it("localizes lifecycle values without changing their stored representations", () => {
    expect(assessmentStateLabel("passed", "zh")).toBe("通过")
    expect(operationStateLabel("queued", "zh")).toBe("排队中")
    expect(operationTypeLabel("publish", "en")).toBe("Publish")
    expect(releaseStateLabel("rolled_back", "zh")).toBe("已回滚")
    expect(roleLabel("tenant-admin", "zh")).toBe("租户管理员")
    expect(siteStatusLabel("active", "zh")).toBe("启用")
  })

  it("keeps an unknown diagnostic value visible instead of guessing its meaning", () => {
    expect(operationStateLabel("future-state", "en")).toBe("future-state")
  })
})

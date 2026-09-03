import { describe, expect, it } from "vitest"

import {
  isWorkflowStatus,
  WORKFLOW_TONE,
  workflowActionsFor,
  workflowStatusLabel,
} from "../../src/components/workflow/workflow-actions-model"

describe("workflowActionsFor (free-flow lane model)", () => {
  it("gives every lane its operator action set, identical across roles", () => {
    const labelsOf = (status: Parameters<typeof workflowActionsFor>[1]) =>
      workflowActionsFor("editor", status).map((action) => action.label)

    expect(labelsOf("draft")).toEqual(["提交审核"])
    expect(labelsOf("generating")).toEqual(["提交审核"])
    expect(labelsOf("review")).toEqual(["审核通过", "审核不通过"])
    expect(labelsOf("approved")).toEqual(["创建发布排期"])
    expect(labelsOf("compiled")).toEqual(["发布版本", "创建发布排期"])
    expect(labelsOf("published")).toEqual(["删除"])
    expect(labelsOf("archived")).toEqual(["恢复"])

    expect(labelsOf("review")).toEqual(workflowActionsFor("publisher", "review").map((a) => a.label))
    expect(labelsOf("published")).toEqual(
      workflowActionsFor("super-admin", "published").map((a) => a.label),
    )
  })

  it("keeps the reject decision confirm- and reason-gated", () => {
    const reject = workflowActionsFor("editor", "review")[1]
    expect(reject).toMatchObject({
      confirm: true,
      reasonRequired: true,
      target: "draft",
      type: "transition",
    })
  })

  it("retires the legacy actions from the surface", () => {
    const all = (
      [
        "draft",
        "generating",
        "review",
        "approved",
        "compiled",
        "published",
        "archived",
      ] as const
    ).flatMap((status) => workflowActionsFor("super-admin", status).map((a) => a.label))
    for (const legacy of ["开始生成", "质量检查", "退回草稿", "归档版本", "创建新草稿"]) {
      expect(all).not.toContain(legacy)
    }
  })
})

describe("workflowStatusLabel", () => {
  it("maps internal states onto the six operator lanes", () => {
    expect(workflowStatusLabel("generating")).toBe("草稿")
    expect(workflowStatusLabel("compiled")).toBe("通过待发布")
    expect(workflowStatusLabel("archived")).toBe("已删除")
    expect(workflowStatusLabel("compiled", "en")).toBe("Compiled")
  })
})

describe("WORKFLOW_TONE", () => {
  it("covers every workflow status with a single shared tone vocabulary", () => {
    expect(Object.keys(WORKFLOW_TONE).sort()).toEqual(
      [
        "approved",
        "archived",
        "compiled",
        "draft",
        "generating",
        "published",
        "review",
      ]
        .filter(isWorkflowStatus)
        .sort(),
    )
  })
})

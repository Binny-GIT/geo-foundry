import { describe, expect, it } from "vitest"

import {
  isWorkflowStatus,
  WORKFLOW_TONE,
  workflowActionsFor,
} from "../../src/components/workflow/workflow-actions-model"

describe("workflowActionsFor", () => {
  it("gives editors the complete draft preparation path", () => {
    expect(workflowActionsFor("editor", "draft")).toEqual([
      {
        label: "开始生成",
        target: "generating",
        tone: "primary",
        type: "transition",
      },
    ])
    expect(workflowActionsFor("editor", "generating")).toEqual([
      {
        label: "提交审核",
        target: "review",
        tone: "primary",
        type: "transition",
      },
      {
        label: "退回草稿",
        target: "draft",
        tone: "secondary",
        type: "transition",
      },
    ])
  })

  it("keeps reviewer and publisher actions scoped to their workflow states", () => {
    expect(workflowActionsFor("reviewer", "review").map((action) => action.label)).toEqual([
      "批准版本",
      "退回修改",
    ])
    expect(workflowActionsFor("publisher", "compiled")).toEqual([
      { label: "发布版本", tone: "primary", type: "publish-operation" },
    ])
    expect(workflowActionsFor("publisher", "published").map((action) => action.label)).toEqual([
      "归档版本",
    ])
  })

  it("does not expose editor transitions to other roles", () => {
    expect(workflowActionsFor("reviewer", "draft")).toEqual([])
    expect(workflowActionsFor("publisher", "generating")).toEqual([])
    expect(workflowActionsFor("tenant-admin", "draft")).toEqual([])
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
      ].filter(isWorkflowStatus).sort(),
    )
  })

  it("reserves the success tone for the only true terminal-good state", () => {
    expect(WORKFLOW_TONE.published).toBe("success")
    expect(Object.values(WORKFLOW_TONE).filter((tone) => tone === "success")).toEqual(["success"])
  })

  it("flags review as the state that needs a human decision", () => {
    expect(WORKFLOW_TONE.review).toBe("warning")
  })

  it("keeps quiet terminal states neutral", () => {
    expect(WORKFLOW_TONE.draft).toBe("neutral")
    expect(WORKFLOW_TONE.archived).toBe("neutral")
  })
})

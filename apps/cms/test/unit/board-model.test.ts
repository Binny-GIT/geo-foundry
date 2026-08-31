import { describe, expect, it } from "vitest"

import { BOARD_COLUMNS, boardCardOf, boardColumnOf, groupBoardCards } from "../../src/console/lib/board-model"

const edition = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  auditLog: [],
  id: 42,
  site: { name: "Site A", timezone: "UTC" },
  title: "Fixture edition",
  updatedAt: "2026-08-30T00:00:00.000Z",
  workflowRevision: 3,
  ...overrides,
})

describe("workbench board model", () => {
  it("keeps the operator's six columns in pipeline order", () => {
    expect(BOARD_COLUMNS.map((column) => column.label)).toEqual([
      "草稿",
      "待审核",
      "通过待发布",
      "不通过",
      "已发布",
      "已删除",
    ])
  })

  it("maps backend states onto board columns without changing them", () => {
    expect(boardColumnOf(edition({ workflowStatus: "draft" }))).toBe("draft")
    expect(boardColumnOf(edition({ workflowStatus: "generating" }))).toBe("draft")
    expect(boardColumnOf(edition({ workflowStatus: "review" }))).toBe("review")
    expect(boardColumnOf(edition({ workflowStatus: "approved" }))).toBe("approved")
    expect(boardColumnOf(edition({ workflowStatus: "compiled" }))).toBe("approved")
    expect(boardColumnOf(edition({ workflowStatus: "published" }))).toBe("published")
    expect(boardColumnOf(edition({ workflowStatus: "archived" }))).toBe("archived")
    expect(boardColumnOf(edition({ workflowStatus: "unknown" }))).toBe(null)
  })

  it("routes a draft whose latest transition is a reviewer rejection to 不通过", () => {
    const rejected = edition({
      auditLog: [
        { action: "content-edition.draft.review", at: "2026-08-30T00:00:01.000Z" },
        {
          action: "content-edition.review.draft",
          at: "2026-08-30T00:00:02.000Z",
          reason: "开头需要更清楚",
        },
      ],
      workflowStatus: "draft",
    })
    expect(boardColumnOf(rejected)).toBe("rejected")
    expect(boardCardOf(rejected)?.rejectedReason).toBe("开头需要更清楚")

    const resubmitted = edition({
      auditLog: [
        { action: "content-edition.review.draft", at: "2026-08-30T00:00:02.000Z", reason: "x" },
        { action: "content-edition.draft.generating", at: "2026-08-30T00:00:03.000Z" },
      ],
      workflowStatus: "generating",
    })
    expect(boardColumnOf(resubmitted)).toBe("draft")
    expect(boardCardOf(resubmitted)?.rejectedReason).toBe(null)
  })

  it("groups cards per column and keeps unknown documents out", () => {
    const grouped = groupBoardCards([
      edition({ id: 1, workflowStatus: "review" }),
      edition({ id: 2, workflowStatus: "published" }),
      edition({ id: 3, workflowStatus: "nonsense" }),
    ])
    expect(grouped.review).toHaveLength(1)
    expect(grouped.published).toHaveLength(1)
    expect(grouped.draft).toHaveLength(0)
  })
})

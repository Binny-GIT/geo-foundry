import { describe, expect, it } from "vitest"

import { canDragCard, dropActionFor } from "../../src/console/lib/board-dnd"

describe("Board drag-and-drop mapping", () => {
  it("Given an editor draft card, when dropping onto any column, then no move resolves (generation starts via the card button)", () => {
    expect(canDragCard("editor", "draft")).toBe(true)
    expect(dropActionFor("editor", "draft", "review")).toBeNull()
    expect(dropActionFor("editor", "draft", "approved")).toBeNull()
    expect(dropActionFor("editor", "draft", "draft")).toBeNull()
  })

  it("Given an editor generating card, when dropping onto review or draft, then transitions resolve", () => {
    expect(dropActionFor("editor", "generating", "review")?.target).toBe("review")
    expect(dropActionFor("editor", "generating", "draft")?.target).toBe("draft")
    expect(dropActionFor("editor", "generating", "approved")).toBeNull()
  })

  it("Given a reviewer review card, when dropping onto approved, draft, or rejected, then reviewer decisions resolve", () => {
    expect(dropActionFor("reviewer", "review", "approved")?.type).toBe("reviewer-approve")
    expect(dropActionFor("reviewer", "review", "draft")?.type).toBe("reviewer-request-changes")
    expect(dropActionFor("reviewer", "review", "draft")?.reasonRequired).toBe(true)
    expect(dropActionFor("reviewer", "review", "rejected")?.type).toBe("reviewer-request-changes")
    expect(dropActionFor("reviewer", "review", "rejected")?.reasonRequired).toBe(true)
  })

  it("Given a publisher compiled card, when dropping onto published, then the publish operation resolves", () => {
    expect(dropActionFor("publisher", "compiled", "published")?.type).toBe("publish-operation")
    expect(dropActionFor("publisher", "published", "archived")?.target).toBe("archived")
    expect(dropActionFor("publisher", "compiled", "archived")).toBeNull()
  })

  it("Given a card outside review, when dropping onto the derived rejected column, then no action resolves", () => {
    expect(dropActionFor("editor", "draft", "rejected")).toBeNull()
    expect(dropActionFor("reviewer", "approved", "rejected")).toBeNull()
  })

  it("Given a super-admin card, when dragging, then the union of role actions resolves per status", () => {
    expect(canDragCard("super-admin", "draft")).toBe(true)
    expect(dropActionFor("super-admin", "draft", "review")).toBeNull()
    expect(dropActionFor("super-admin", "review", "rejected")?.type).toBe(
      "reviewer-request-changes",
    )
    expect(dropActionFor("super-admin", "review", "approved")?.type).toBe("reviewer-approve")
    expect(dropActionFor("super-admin", "compiled", "published")?.type).toBe("publish-operation")
    expect(dropActionFor("super-admin", "published", "archived")?.target).toBe("archived")
    expect(dropActionFor("super-admin", "published", "draft")?.type).toBe("draft-from-published")
  })

  it("Given an approved card, when a publisher drops it on published, then the schedule dialog action resolves", () => {
    expect(canDragCard("publisher", "approved")).toBe(true)
    expect(canDragCard("super-admin", "approved")).toBe(true)
    expect(canDragCard("editor", "approved")).toBe(false)
    expect(dropActionFor("publisher", "approved", "published")).toMatchObject({
      type: "publish-schedule",
      label: "创建发布排期",
    })
    expect(dropActionFor("editor", "approved", "published")).toBeNull()
    expect(dropActionFor("publisher", "approved", "draft")).toBeNull()
  })

  it("Given an archived card, when any role drags, then no card moves exist because archived is terminal", () => {
    expect(canDragCard("super-admin", "archived")).toBe(false)
    expect(canDragCard("publisher", "archived")).toBe(false)
    expect(dropActionFor("super-admin", "archived", "draft")).toBeNull()
    expect(dropActionFor("super-admin", "archived", "published")).toBeNull()
  })

  it("Given a role without actions for the status, when dragging, then the card is not draggable and drops resolve to nothing", () => {
    expect(canDragCard("publisher", "draft")).toBe(false)
    expect(canDragCard("editor", "review")).toBe(false)
    expect(canDragCard("editor", "draft")).toBe(true)
    expect(dropActionFor("publisher", "draft", "review")).toBeNull()
  })
})

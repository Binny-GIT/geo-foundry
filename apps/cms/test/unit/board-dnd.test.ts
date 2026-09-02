import { describe, expect, it } from "vitest"

import { canDragCard, dropActionFor } from "@/console/lib/board-dnd"

describe("Board drag-and-drop mapping", () => {
  it("Given an editor draft card, when dropping onto generating/review, then only generating resolves", () => {
    expect(dropActionFor("editor", "draft", "generating")?.type).toBe("transition")
    expect(dropActionFor("editor", "draft", "generating")?.target).toBe("generating")
    expect(dropActionFor("editor", "draft", "review")).toBeNull()
    expect(dropActionFor("editor", "draft", "approved")).toBeNull()
    expect(dropActionFor("editor", "draft", "published")).toBeNull()
  })

  it("Given an editor generating card, when dropping onto review or draft, then transitions resolve", () => {
    expect(dropActionFor("editor", "generating", "review")?.target).toBe("review")
    expect(dropActionFor("editor", "generating", "draft")?.target).toBe("draft")
    expect(dropActionFor("editor", "generating", "approved")).toBeNull()
  })

  it("Given a reviewer review card, when dropping onto approved or draft, then reviewer decisions resolve", () => {
    expect(dropActionFor("reviewer", "review", "approved")?.type).toBe("reviewer-approve")
    expect(dropActionFor("reviewer", "review", "draft")?.type).toBe("reviewer-request-changes")
    expect(dropActionFor("reviewer", "review", "draft")?.reasonRequired).toBe(true)
  })

  it("Given a publisher compiled card, when dropping onto published, then the publish operation resolves", () => {
    expect(dropActionFor("publisher", "compiled", "published")?.type).toBe("publish-operation")
    expect(dropActionFor("publisher", "published", "archived")?.target).toBe("archived")
    expect(dropActionFor("publisher", "compiled", "archived")).toBeNull()
  })

  it("Given any card, when dropping onto the derived rejected column, then no action resolves", () => {
    expect(dropActionFor("reviewer", "review", "rejected")).toBeNull()
    expect(dropActionFor("editor", "draft", "rejected")).toBeNull()
  })

  it("Given a role without actions for the status, when dragging, then the card is not draggable and drops resolve to nothing", () => {
    expect(canDragCard("publisher", "draft")).toBe(false)
    expect(canDragCard("editor", "review")).toBe(false)
    expect(canDragCard("editor", "draft")).toBe(true)
    expect(dropActionFor("publisher", "draft", "generating")).toBeNull()
  })
})

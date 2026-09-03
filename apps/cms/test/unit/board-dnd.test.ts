import { describe, expect, it } from "vitest"

import {
  canDragCard,
  dropActionFor,
  dropHintFor,
  ownColumnOf,
} from "../../src/console/lib/board-dnd"

describe("free-flow board drag mapping", () => {
  it("lets cards move freely between lanes via transitions", () => {
    expect(dropActionFor("editor", "draft", "review")).toMatchObject({
      target: "review",
      type: "transition",
    })
    expect(dropActionFor("reviewer", "review", "approved")).toMatchObject({
      target: "approved",
    })
    expect(dropActionFor("publisher", "published", "archived")).toMatchObject({
      target: "archived",
    })
    expect(dropActionFor("editor", "archived", "draft")).toMatchObject({
      target: "draft",
    })
    expect(dropActionFor("editor", "published", "review")).toMatchObject({
      target: "review",
    })
  })

  it("routes publishable cards dropped on 已发布 to the schedule dialog", () => {
    expect(dropActionFor("editor", "approved", "published")).toMatchObject({
      type: "publish-schedule",
    })
    expect(dropActionFor("publisher", "compiled", "published")).toMatchObject({
      type: "publish-schedule",
    })
    expect(dropActionFor("editor", "draft", "published")).toBeNull()
    expect(dropHintFor({ workflowStatus: "draft" }, "published")).toContain("通过待发布")
  })

  it("treats 不通过 as the reject decision and refuses it only for draft cards", () => {
    expect(dropActionFor("editor", "review", "rejected")).toMatchObject({
      reasonRequired: true,
      target: "draft",
      type: "transition",
    })
    expect(dropActionFor("editor", "approved", "rejected")).toMatchObject({
      target: "draft",
    })
    expect(dropActionFor("editor", "draft", "rejected")).toBeNull()
  })

  it("makes every card draggable and same-lane drops inert", () => {
    for (const status of ["draft", "review", "approved", "published", "archived"]) {
      expect(canDragCard("editor", status)).toBe(true)
    }
    expect(ownColumnOf({ workflowStatus: "compiled" })).toBe("approved")
    expect(ownColumnOf({ rejectedReason: "收紧", workflowStatus: "draft" })).toBe("rejected")
    expect(dropActionFor("editor", "review", "review")).toBeNull()
    expect(dropActionFor("editor", "generating", "draft")).toBeNull()
  })
})

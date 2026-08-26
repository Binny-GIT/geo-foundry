import { describe, expect, it } from "vitest"

import { workspaceUserOf } from "../../src/components/workspaces/workspace-server-context"

describe("workspaceUserOf", () => {
  it("uses the top-level user supplied by Payload built-in views", () => {
    expect(workspaceUserOf({ user: { role: "super-admin" } })).toEqual({ role: "super-admin" })
  })

  it("uses initPageResult request user for arbitrary custom admin paths", () => {
    expect(
      workspaceUserOf({ initPageResult: { req: { user: { role: "tenant-admin" } } } }),
    ).toEqual({ role: "tenant-admin" })
  })

  it("never invents an identity for an anonymous or malformed context", () => {
    expect(workspaceUserOf({ initPageResult: { req: { user: null } } })).toBeUndefined()
  })
})

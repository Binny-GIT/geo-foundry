import { describe, expect, it } from "vitest"

import { compileSnapshotSchema } from "../src/schemas.js"

const snapshot = {
  editions: [],
  listings: {},
  notFound: { pathname: "/not-found" },
  redirects: [],
  site: {},
}

describe("compile snapshot transport", () => {
  it("preserves gone paths for the worker compiler", () => {
    const parsed = compileSnapshotSchema.parse({
      ...snapshot,
      gonePathnames: ["/articles/removed"],
    })
    expect(parsed.gonePathnames).toEqual(["/articles/removed"])
  })

  it("accepts older snapshots without gone paths", () => {
    expect(compileSnapshotSchema.parse(snapshot).gonePathnames).toBeUndefined()
  })
})

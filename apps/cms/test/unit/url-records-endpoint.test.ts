import { describe, expect, it } from "vitest"

import { renameUrlRecordEndpoint } from "../../src/endpoints/url-records"

describe("URL record endpoint", () => {
  it("uses a route namespace that cannot collide with Payload collection REST routes", () => {
    expect(renameUrlRecordEndpoint.path).toBe("/url-record-operations/:id/rename")
    expect(renameUrlRecordEndpoint.path).not.toContain("/url-records/")
  })
})

import { describe, expect, it } from "vitest"

import { createRollbackIntentEndpoint } from "../../src/endpoints/rollback-intents"

describe("rollback intent endpoint", () => {
  it("uses a route namespace that cannot collide with Payload collection REST routes", () => {
    expect(createRollbackIntentEndpoint.path).toBe("/rollback-operations/intents")
    expect(createRollbackIntentEndpoint.path).not.toBe("/rollback-intents")
  })
})

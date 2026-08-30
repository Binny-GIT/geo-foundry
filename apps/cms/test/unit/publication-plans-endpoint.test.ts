import { describe, expect, it } from "vitest"

import {
  cancelPublicationPlanEndpoint,
  createPublicationPlanEndpoint,
} from "../../src/endpoints/publication-plans"

describe("publication plan endpoints", () => {
  it("uses an operations namespace that cannot collide with collection REST routes", () => {
    expect(createPublicationPlanEndpoint.path).toBe("/publication-plan-operations")
    expect(createPublicationPlanEndpoint.path).not.toBe("/publication-plans")
    expect(cancelPublicationPlanEndpoint.path).toBe("/publication-plan-operations/:planId/cancel")
  })
})

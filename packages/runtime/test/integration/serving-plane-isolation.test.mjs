import { describe, expect, it } from "vitest"

const enabled = process.env.GEO_FOUNDRY_SERVING_ISOLATION === "true"

describe.skipIf(!enabled)("serving plane isolation against shared RustFS", () => {
  it("serves cold releases while only RustFS is reachable and recovers after RustFS denial", async () => {
    const { runServingIsolation } = await import("../../scripts/serving-isolation.mjs")
    const evidence = await runServingIsolation()

    expect(evidence.coldRequests).toHaveLength(8)
    expect(evidence.normalAccess.length).toBeGreaterThan(0)
    expect(evidence.normalEgress.forbiddenAttempts).toBe(0)
    expect(evidence.recovery.status).toBe(200)
    expect(evidence.denied.status).toBe(503)
  }, 60_000)
})

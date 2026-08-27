import { describe, expect, it } from "vitest"

import { createWorkerRuntime, workerOptionsOf } from "../../src/runtime/worker-runtime.js"

const config = (overrides: Record<string, unknown> = {}) =>
  ({
    connection: { db: 0, host: "127.0.0.1", port: 6379 },
    context: {},
    logger: () => {},
    processors: {},
    ...overrides,
  }) as never

describe("Worker runtime recovery options", () => {
  it("keeps production stalled recovery defaults", () => {
    const options = workerOptionsOf("generation", config())

    expect(options).toMatchObject({
      lockDuration: 30_000,
      maxStalledCount: 1,
      stalledInterval: 30_000,
    })
  })

  it("accepts an explicit short recovery interval for fault tests", () => {
    const options = workerOptionsOf(
      "generation",
      config({ recovery: { maxStalledCount: 0, stalledIntervalMs: 250 } }),
    )

    expect(options).toMatchObject({
      maxStalledCount: 0,
      stalledInterval: 250,
    })
  })

  it("rejects a missing workload processor", () => {
    expect(() => createWorkerRuntime(config())).toThrow("WORKER_PROCESSOR_MISSING:compile")
  })

  it("rejects invalid recovery settings", () => {
    expect(() =>
      workerOptionsOf("generation", config({ recovery: { stalledIntervalMs: 0 } })),
    ).toThrow("WORKER_RECOVERY_OPTIONS_INVALID")
  })
})

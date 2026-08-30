import { describe, expect, it } from "vitest"

import { operationProcessor } from "../../src/processors/operation-processor.js"
import { TerminalJobError } from "../../src/processors/types.js"

const operationId = "11111111-2222-3333-4444-555555555555"

const contextOf = () => {
  const completions: Record<string, unknown>[] = []
  const logs: string[] = []
  return {
    completions,
    context: {
      client: {
        completeOperationStage: async (_id: string, input: Record<string, unknown>) => {
          completions.push(input)
        },
        getOperation: async () => ({ attempt: 1, operationId }),
        startOperationStage: async () => undefined,
      },
      logger: (event: { code: string }) => logs.push(event.code),
    } as never,
    logs,
  }
}

const job = { data: { operationId }, id: "fault-job", queueName: "content-publish" } as never

describe("operation processor fault handling", () => {
  it("records stale pointer conflicts as one terminal ledger failure", async () => {
    const fixture = contextOf()
    const processor = operationProcessor(
      { context: fixture.context },
      {
        stage: "publish-gate",
        work: async () => {
          throw new TerminalJobError(
            "ARTIFACT_STORE_POINTER_ETAG_STALE",
            "Current pointer ETag does not match the compare-and-swap precondition",
          )
        },
      },
    )

    await expect(processor(job)).resolves.toEqual({
      kind: "failed",
      reason: "ARTIFACT_STORE_POINTER_ETAG_STALE",
    })
    expect(fixture.completions).toEqual([
      {
        attempt: 1,
        error: {
          code: "ARTIFACT_STORE_POINTER_ETAG_STALE",
          message: "Current pointer ETag does not match the compare-and-swap precondition",
        },
        outcome: "failed",
        stage: "publish-gate",
      },
    ])
    expect(fixture.logs).toContain("worker.job.terminal-failure")
    expect(fixture.logs).not.toContain("worker.job.retryable-failure")
  })

  it("keeps ordinary storage failures retryable", async () => {
    const fixture = contextOf()
    const processor = operationProcessor(
      { context: fixture.context },
      {
        stage: "publish-gate",
        work: async () => {
          throw new Error("temporary storage outage")
        },
      },
    )

    await expect(processor(job)).rejects.toThrow("temporary storage outage")
    expect(fixture.completions).toEqual([])
    expect(fixture.logs).toContain("worker.job.retryable-failure")
  })

  it("terminalizes the ledger when BullMQ exhausts retryable attempts", async () => {
    const fixture = contextOf()
    const processor = operationProcessor(
      { context: fixture.context },
      {
        stage: "publish-gate",
        work: async () => {
          throw new Error("site lacks canonical domain")
        },
      },
    )
    const finalAttemptJob = {
      attemptsMade: 2,
      data: { operationId },
      id: "fault-job-final",
      opts: { attempts: 3 },
      queueName: "content-publish",
    } as never

    await expect(processor(finalAttemptJob)).resolves.toEqual({
      kind: "failed",
      reason: "WORKER_RETRY_EXHAUSTED",
    })
    expect(fixture.completions).toEqual([
      {
        attempt: 1,
        error: {
          code: "WORKER_RETRY_EXHAUSTED",
          message: "site lacks canonical domain",
        },
        outcome: "failed",
        stage: "publish-gate",
      },
    ])
    expect(fixture.logs).toContain("worker.job.retry-exhausted")
  })
})

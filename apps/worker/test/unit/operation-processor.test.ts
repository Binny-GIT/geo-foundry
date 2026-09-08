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

const job = {
  data: { operationId },
  id: "fault-job",
  name: "publish-gate",
  queueName: "operation-publish",
} as never

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

  it("retries ordinary failures in-process and terminalizes after exhausting attempts", async () => {
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

    // 重试内部化（pg-boss 队列不再重试）：三次尝试耗尽后写回台账终态并返回 failed。
    await expect(processor(job)).resolves.toEqual({
      kind: "failed",
      reason: "WORKER_RETRY_EXHAUSTED",
    })
    expect(fixture.completions).toEqual([
      {
        attempt: 1,
        error: {
          code: "WORKER_RETRY_EXHAUSTED",
          message: "temporary storage outage",
        },
        outcome: "failed",
        stage: "publish-gate",
      },
    ])
    expect(fixture.logs).toContain("worker.job.retryable-failure")
    expect(fixture.logs).toContain("worker.job.retry-exhausted")
  })

  it("succeeds on a later in-process attempt after a transient failure", async () => {
    const fixture = contextOf()
    let attempts = 0
    const processor = operationProcessor(
      { context: fixture.context },
      {
        stage: "publish-gate",
        work: async () => {
          attempts += 1
          if (attempts === 1) throw new Error("temporary storage outage")
          return { kind: "succeeded" as const, result: { attempts } }
        },
      },
    )

    await expect(processor(job)).resolves.toEqual({
      kind: "succeeded",
      result: { attempts: 2 },
    })
    expect(fixture.completions).toHaveLength(1)
    expect(fixture.logs).toContain("worker.job.retryable-failure")
    expect(fixture.logs).toContain("worker.job.succeeded")
  })
})

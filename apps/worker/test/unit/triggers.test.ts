import { StalePointerEtagError } from "@geo/publisher"
import { describe, expect, it, vi } from "vitest"

const compileAndPlanRelease = vi.hoisted(() => vi.fn())

vi.mock("../../src/processors/release-pipeline.js", () => ({
  compileAndPlanRelease,
  createWorkerArtifactStore: vi.fn(),
  parseWorkerS3Options: vi.fn(),
  publishPlannedRelease: vi.fn(),
}))

import {
  createCompileTriggerProcessor,
  terminalPublishErrorOf,
} from "../../src/processors/triggers.js"

const operationId = "11111111-2222-3333-4444-555555555555"

const processorContext = () => {
  const recordCompileResult = vi.fn(async () => ({
    releaseId: "release-worker-compile",
    workflowStatus: "compiled",
  }))
  const completeOperationStage = vi.fn(async () => undefined)
  return {
    context: {
      client: {
        completeOperationStage,
        getOperation: async () => ({ attempt: 1, operationId }),
        recordCompileResult,
        startOperationStage: async () => undefined,
      },
      logger: () => undefined,
    } as never,
    recordCompileResult,
  }
}

describe("compile trigger", () => {
  it("correlates compile evidence with the ledger operation", async () => {
    compileAndPlanRelease.mockResolvedValueOnce({
      manifestSha256: "a".repeat(64),
      objectCount: 2,
      plan: { manifest: { objects: [{ bytes: 11 }, { bytes: 13 }] } },
      releaseId: "release-worker-compile",
    })
    const fixture = processorContext()
    const processor = createCompileTriggerProcessor(fixture.context)

    await processor({
      data: { operationId, payload: { body: { editionId: 42 } } },
      id: "compile-job",
      queueName: "content-compile",
    } as never)

    expect(fixture.recordCompileResult).toHaveBeenCalledWith(
      42,
      {
        manifestSha256: "a".repeat(64),
        objectCount: 2,
        releaseId: "release-worker-compile",
        totalBytes: 24,
      },
      { operationId },
    )
  })
})

describe("publish gate error classification", () => {
  it("terminalizes a stale pointer CAS conflict", () => {
    const terminal = terminalPublishErrorOf(
      new StalePointerEtagError('"expected"' as never, '"actual"' as never),
    )

    expect(terminal).toMatchObject({
      code: "ARTIFACT_STORE_POINTER_ETAG_STALE",
      name: "TerminalJobError",
    })
  })

  it("leaves ordinary storage failures retryable", () => {
    expect(terminalPublishErrorOf(new Error("temporary S3 failure"))).toBeNull()
  })
})

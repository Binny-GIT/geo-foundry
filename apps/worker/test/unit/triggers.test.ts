import { operationJobDataOf } from "@geo/content-client"
import { rollbackRelease, StalePointerEtagError } from "@geo/publisher"
import { beforeEach, describe, expect, it, vi } from "vitest"

const pipeline = vi.hoisted(() => ({
  compileAndPlanRelease: vi.fn(),
  createWorkerArtifactStore: vi.fn(),
  parseWorkerS3Options: vi.fn(),
  publishPlannedRelease: vi.fn(),
}))

vi.mock("../../src/processors/release-pipeline.js", () => ({
  compileAndPlanRelease: pipeline.compileAndPlanRelease,
  createWorkerArtifactStore: pipeline.createWorkerArtifactStore,
  parseWorkerS3Options: pipeline.parseWorkerS3Options,
  publishPlannedRelease: pipeline.publishPlannedRelease,
}))

vi.mock("@geo/publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@geo/publisher")>()),
  rollbackRelease: vi.fn(),
}))

import {
  createCompileTriggerProcessor,
  createPublishGateProcessor,
  createRollbackGateProcessor,
  terminalPublishErrorOf,
} from "../../src/processors/triggers.js"

const operationId = "11111111-2222-3333-4444-555555555555"

const processorContext = () => {
  const recordCompileResult = vi.fn(async () => ({
    releaseId: "release-worker-compile",
    workflowStatus: "compiled",
  }))
  const completeOperationStage = vi.fn(async () => undefined)
  const consumeRollbackIntent = vi.fn(async () => undefined)
  const recordRollbackReceipt = vi.fn(async () => undefined)
  return {
    context: {
      client: {
        completeOperationStage,
        consumeRollbackIntent,
        getOperation: async () => ({ attempt: 1, operationId }),
        recordCompileResult,
        recordRollbackReceipt,
        startOperationStage: async () => undefined,
      },
      logger: () => undefined,
    } as never,
    completeOperationStage,
    consumeRollbackIntent,
    recordCompileResult,
  }
}

const planned = {
  manifestSha256: "a".repeat(64),
  objectCount: 2,
  plan: { manifest: { objects: [{ bytes: 11 }, { bytes: 13 }] } },
  releaseId: "release-worker-compile",
  siteId: 375,
}

const rollbackBody = {
  expectedCurrentManifestSha256: "b".repeat(64),
  expectedCurrentReleaseId: "rel-previous-release",
  expectedManifestSha256: "c".repeat(64),
  rollbackIntentId: "11111111-2222-4333-8444-555555555555",
  siteId: "site-375",
  targetReleaseId: "rel-target-release",
}

describe("compile trigger", () => {
  it("correlates compile evidence with the ledger operation", async () => {
    pipeline.compileAndPlanRelease.mockResolvedValueOnce(planned)
    const fixture = processorContext()
    const processor = createCompileTriggerProcessor(fixture.context)

    await processor({
      data: operationJobDataOf({
        body: { editionId: 42 },
        operationId,
        operationType: "publish",
        stage: "compile-trigger",
        tenantId: 413,
      }),
      id: "compile-job",
      queueName: "operation-publish",
    } as never)

    expect(fixture.recordCompileResult).toHaveBeenCalledWith(
      42,
      {
        manifestSha256: "a".repeat(64),
        objectCount: 2,
        releaseId: "release-worker-compile",
        siteId: 375,
        totalBytes: 24,
      },
      { operationId },
    )
  })
})

describe("operation job payload contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("publish-gate: parses job data built with the shared builder", async () => {
    pipeline.compileAndPlanRelease.mockResolvedValueOnce(planned)
    pipeline.publishPlannedRelease.mockResolvedValueOnce({
      manifestSha256: "a".repeat(64),
      releaseId: "release-worker-compile",
    })
    const fixture = processorContext()
    const processor = createPublishGateProcessor(fixture.context)

    const outcome = await processor({
      data: operationJobDataOf({
        body: { editionId: 42, siteId: 375 },
        operationId,
        operationType: "publish",
        stage: "publish-gate",
        tenantId: 413,
      }),
      id: "publish-job",
      queueName: "operation-publish",
    } as never)

    expect(pipeline.compileAndPlanRelease).toHaveBeenCalledWith(fixture.context, {
      editionId: 42,
      operationId,
      siteId: 375,
    })
    expect(outcome).toMatchObject({
      kind: "succeeded",
      result: { releaseId: "release-worker-compile", siteId: 375 },
    })
  })

  it("publish-gate: terminalizes the legacy flat payload (2026-09-09 事故形状)", async () => {
    const fixture = processorContext()
    const processor = createPublishGateProcessor(fixture.context)

    const outcome = await processor({
      data: {
        operationId,
        payload: { editionId: 42, operationType: "publish", releaseId: "rel-op", siteId: 7 },
      },
      id: "legacy-publish",
      queueName: "operation-publish",
    } as never)

    expect(outcome).toEqual({ kind: "failed", reason: "RELEASE_PAYLOAD_INVALID" })
    expect(fixture.completeOperationStage).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({
        error: expect.objectContaining({ code: "RELEASE_PAYLOAD_INVALID" }),
        outcome: "failed",
      }),
    )
    expect(pipeline.compileAndPlanRelease).not.toHaveBeenCalled()
  })

  it("rollback-gate: parses the shared builder payload and consumes the intent", async () => {
    vi.mocked(rollbackRelease).mockResolvedValueOnce({
      receipt: { releaseId: "rel-target-release", siteId: "site-375" },
    })
    const fixture = processorContext()
    const processor = createRollbackGateProcessor(fixture.context)

    const outcome = await processor({
      data: operationJobDataOf({
        body: rollbackBody,
        operationId,
        operationType: "rollback",
        stage: "rollback-gate",
        tenantId: 413,
      }),
      id: "rollback-job",
      queueName: "operation-publish",
    } as never)

    expect(outcome.kind).toBe("succeeded")
    expect(fixture.consumeRollbackIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        rollbackIntentId: "11111111-2222-4333-8444-555555555555",
        runtimeSiteId: "site-375",
      }),
    )
    expect(rollbackRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: "rel-target-release",
        siteId: "site-375",
      }),
    )
  })

  it("rollback-gate: terminalizes the legacy flat payload (2026-09-09 事故形状)", async () => {
    const fixture = processorContext()
    const processor = createRollbackGateProcessor(fixture.context)

    const outcome = await processor({
      data: {
        operationId,
        // 旧 CMS 把 body 内容直接当 payload 发送（无 body 包装）。
        payload: rollbackBody,
      },
      id: "legacy-rollback",
      queueName: "operation-publish",
    } as never)

    expect(outcome).toEqual({ kind: "failed", reason: "ROLLBACK_PAYLOAD_INVALID" })
    expect(fixture.consumeRollbackIntent).not.toHaveBeenCalled()
    expect(rollbackRelease).not.toHaveBeenCalled()
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

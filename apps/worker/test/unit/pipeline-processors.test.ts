import { describe, expect, it, vi } from "vitest"

import {
  createEvaluationProcessor,
  createGenerationProcessor,
} from "../../src/processors/pipeline-processors.js"

const operationId = "22222222-3333-4444-5555-666666666666"

const processorContext = () => {
  const completeOperationStage = vi.fn(async () => undefined)
  return {
    context: {
      client: {
        completeOperationStage,
        getOperation: async () => ({ attempt: 1, operationId }),
        startOperationStage: async () => undefined,
      },
      logger: () => undefined,
    } as never,
    completeOperationStage,
  }
}

/** 2026-09-09 之前的入队形状：body 内容散在 payload 顶层。 */
const legacyFlat = (body: Record<string, unknown>) =>
  ({
    data: { operationId, payload: body },
    id: "legacy-job",
    queueName: "operation-evaluation",
  }) as never

describe("evaluation processor payload contract", () => {
  it("terminalizes the legacy flat payload", async () => {
    const fixture = processorContext()
    const processor = createEvaluationProcessor(fixture.context, {} as never)

    const outcome = await processor(legacyFlat({ editionId: 42 }))

    expect(outcome).toEqual({ kind: "failed", reason: "EVALUATION_PAYLOAD_INVALID" })
    expect(fixture.completeOperationStage).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({
        error: expect.objectContaining({ code: "EVALUATION_PAYLOAD_INVALID" }),
        outcome: "failed",
      }),
    )
  })
})

describe("generation processor payload contract", () => {
  it("terminalizes the legacy flat payload", async () => {
    const fixture = processorContext()
    const processor = createGenerationProcessor(fixture.context, {} as never)

    const outcome = await processor(
      legacyFlat({
        brief: { intent: "x", sources: [{ id: "s", snippet: "y", title: "z" }], topic: "t" },
        contentId: 1,
        targets: [{ angle: "a", editionId: 2, siteStrategy: { locale: "en-US", name: "S" } }],
      }),
    )

    expect(outcome).toEqual({ kind: "failed", reason: "GENERATION_PAYLOAD_INVALID" })
    expect(fixture.completeOperationStage).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({
        error: expect.objectContaining({ code: "GENERATION_PAYLOAD_INVALID" }),
        outcome: "failed",
      }),
    )
  })
})

import { describe, expect, it, vi } from "vitest"

import type { EditionInput, OperationSnapshot } from "@geo/content-client"

import { createFakeProvider } from "../../src/providers/fake.js"
import { ProviderError } from "../../src/providers/errors.js"
import { draftDocumentOf } from "../../src/pipelines/draft-document.js"
import { evaluateEdition, runEvaluationOperation } from "../../src/pipelines/evaluate.js"
import { runGenerationOperation } from "../../src/pipelines/generate.js"

const editionInput = (inputHash: string): EditionInput => ({
  body: [
    { blockType: "heading", level: "2", text: "Deterministic release gates" },
    { blockType: "paragraph", text: "Every edition passes three gates before it ships." },
  ],
  contentId: 12,
  editionId: 101,
  inputHash,
  primaryTopic: "gates",
  secondaryTopics: [],
  siteId: 1,
  summary: "How deterministic gates protect releases.",
  tenantId: 7,
  title: "Deterministic release gates",
  workflowRevision: 0,
  workflowStatus: "draft",
})

const operationSnapshot = (stage: string): OperationSnapshot => ({
  attempt: 1,
  requestPayload: {},
  currentStage: stage,
  endpoint: "/v1/generate",
  error: null,
  operationId: "op-0001-abcd",
  operationType: "generate",
  result: null,
  state: "running",
  tenantId: 7,
})

const depsWith = (edition: EditionInput) => {
  const stages: { stage: string; outcome?: string }[] = []
  const drafts: { body: unknown[]; title: string }[] = []
  const assessments: { state: string; issues: { code: string; severity: string }[] }[] = []
  const client = {
    completeOperationStage: vi.fn(
      async (_id: string, request: { stage: string; outcome: string }) => {
        stages.push({ outcome: request.outcome, stage: request.stage })
        return operationSnapshot(request.stage)
      },
    ),
    findSimilarEditions: vi.fn(async () => []),
    getEditionInput: vi.fn(async () => edition),
    recordAssessment: vi.fn(
      async (
        _editionId: number,
        request: { state: string; issues: { code: string; severity: string }[] },
      ) => {
        assessments.push({ issues: request.issues, state: request.state })
        return { assessmentId: 41 + assessments.length }
      },
    ),
    startOperationStage: vi.fn(async (_id: string, request: { stage: string }) => {
      stages.push({ stage: request.stage })
      return operationSnapshot(request.stage)
    }),
    storeEmbedding: vi.fn(async () => ({ created: true, embeddingId: 1, embeddingKey: "k" })),
    writeDraftVersion: vi.fn(
      async (_editionId: number, patch: { body: unknown[]; title: string }) => {
        drafts.push({ body: patch.body, title: patch.title })
        return {
          fields: ["body", "title"],
          inputHash: "h",
          workflowRevision: 0,
          workflowStatus: "draft",
        }
      },
    ),
  }
  return { assessments, client, drafts, stages }
}

const documentOf = (edition: EditionInput) =>
  draftDocumentOf({
    body: edition.body,
    contentId: edition.contentId,
    pathname: `/drafts/${edition.editionId}`,
    siteId: "site-a",
    summary: edition.summary,
    title: edition.title,
  })

describe("evaluateEdition", () => {
  it("records one aggregate assessment from three clean layers", async () => {
    const edition = editionInput("a".repeat(64))
    const { assessments, client } = depsWith(edition)
    const evaluation = await evaluateEdition(
      { client, provider: createFakeProvider() },
      {
        document: documentOf(edition),
        editionId: 101,
        siteAngle: "practitioner",
        siteName: "Site A",
      },
    )
    expect(evaluation.aggregate.decision).toBe("passed")
    expect(evaluation.assessmentId).toBeGreaterThan(0)
    expect(assessments).toHaveLength(1)
    expect(assessments[0]?.state).toBe("passed")
  })

  it("blocks fail-closed when the provider times out", async () => {
    const edition = editionInput("b".repeat(64))
    const { assessments, client } = depsWith(edition)
    const provider = {
      ...createFakeProvider(),
      generate() {
        throw new ProviderError("PROVIDER_TIMEOUT", "retryable", "deadline")
      },
    }
    const evaluation = await evaluateEdition(
      { client, provider },
      { document: documentOf(edition), editionId: 101, siteAngle: "a", siteName: "s" },
    )
    expect(evaluation.aggregate.decision).toBe("blocked")
    expect(evaluation.aggregate.gate.reasons).toContain("GATE_LAYER_ERROR")
    expect(assessments[0]?.state).toBe("error")
  })
})

describe("runEvaluationOperation", () => {
  it("journeys the evaluation stage on the ledger", async () => {
    const edition = editionInput("c".repeat(64))
    const { client, stages } = depsWith(edition)
    const result = await runEvaluationOperation(
      { client, provider: createFakeProvider() },
      { attempt: 1, editionId: 101, operationId: "op-0001-abcd" },
      documentOf,
    )
    expect(result.operation.currentStage).toBe("evaluation")
    expect(stages.map((stage) => stage.stage)).toEqual(["evaluation", "evaluation"])
    expect(result.aggregate.decision).toBe("passed")
  })
})

describe("runGenerationOperation", () => {
  const brief = {
    intent: "Explain deterministic gates for two sites",
    sources: [{ id: "src-1", snippet: "Gates run before release.", title: "PRD" }],
    topic: "Deterministic content gates",
  }
  const targets = [
    {
      angle: "practitioner-playbook",
      editionId: 101,
      siteStrategy: { locale: "en-US", name: "Site A" },
    },
    {
      angle: "operations-runbook",
      editionId: 102,
      siteStrategy: { locale: "sv-SE", name: "Site B" },
    },
  ]
  const input = {
    attempt: 1,
    brief,
    contentId: 12,
    operationId: "op-0001-abcd",
    requestId: "req-gen-1",
    targets,
  }

  it("generates two angle-specific drafts and passes the gate", async () => {
    const edition = editionInput("d".repeat(64))
    const { assessments, client, drafts, stages } = depsWith(edition)
    const result = await runGenerationOperation({ client, provider: createFakeProvider() }, input)
    expect(result.outcomes).toHaveLength(2)
    expect(result.outcomes.map((outcome) => outcome.decision)).toEqual(["passed", "passed"])
    expect(result.outcomes.every((outcome) => !outcome.revised)).toBe(true)
    expect(drafts).toHaveLength(2)
    expect(stages.map((stage) => stage.stage)).toEqual([
      "outline-101",
      "outline-101",
      "draft-101",
      "draft-101",
      "adaptation-101",
      "adaptation-101",
      "outline-102",
      "outline-102",
      "draft-102",
      "draft-102",
      "adaptation-102",
      "adaptation-102",
      "generation",
    ])
    expect(assessments).toHaveLength(2)
  })

  it("revises exactly once when the first gate fails", async () => {
    const edition = editionInput("e".repeat(64))
    const { client, drafts } = depsWith(edition)
    let calls = 0
    const provider = {
      ...createFakeProvider(),
      async generate(request: { promptVersion: string }) {
        if (request.promptVersion === "quality-evaluation-v1") {
          calls += 1
          const failing = calls === 1
          return {
            content: {
              dimensions: { geo: 90, originality: 90, quality: 90, seo: 90, siteFit: 90 },
              issues: [],
              overall: failing ? 70 : 92,
              recommendations: [],
              schemaVersion: 1,
            } as never,
            latencyMs: 1,
            modelId: "fake-chat-v1",
            providerId: "fake",
            rawResponseHash: "f".repeat(64),
          }
        }
        const providerInstance = createFakeProvider()
        return providerInstance.generate(request as never)
      },
    }
    const result = await runGenerationOperation({ client, provider }, input)
    expect(result.outcomes[0]?.revised).toBe(true)
    expect(result.outcomes[0]?.decision).toBe("passed")
    expect(result.outcomes[1]?.revised).toBe(false)
    expect(drafts).toHaveLength(3)
  })

  it("refuses to generate without an operator research bundle", async () => {
    const edition = editionInput("f".repeat(64))
    const { client } = depsWith(edition)
    await expect(
      runGenerationOperation(
        { client, provider: createFakeProvider() },
        { ...input, brief: { ...brief, sources: [] } },
      ),
    ).rejects.toThrow("GENERATION_BRIEF_SOURCES_REQUIRED")
  })
})

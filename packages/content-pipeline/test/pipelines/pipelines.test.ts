import { describe, expect, it, vi } from "vitest"

import type { EditionInput } from "@geo/content-client"

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

const depsWith = (edition: EditionInput) => {
  const drafts: { body: unknown[]; title: string }[] = []
  const assessments: { state: string; issues: { code: string; severity: string }[] }[] = []
  const client = {
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
  return { assessments, client, drafts }
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
  it("normalizes Payload block storage fields before schema validation", () => {
    const document = draftDocumentOf({
      body: [
        {
          blockName: "heading-1",
          blockType: "heading",
          extensions: null,
          id: "stored-row-id",
          level: "2",
          text: "Stored heading",
        },
      ],
      contentId: 12,
      pathname: "/drafts/101",
      siteId: "site-a",
      summary: "Stored body conversion",
      title: "Stored heading",
    })
    expect(document.body[0]).toMatchObject({
      id: "generated-block-0",
      level: 2,
      text: "Stored heading",
      type: "heading",
    })
  })

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
  it("records evaluation evidence without changing the operation ledger", async () => {
    const edition = editionInput("c".repeat(64))
    const { assessments, client } = depsWith(edition)
    const result = await runEvaluationOperation(
      { client, provider: createFakeProvider() },
      { attempt: 1, editionId: 101, operationId: "op-0001-abcd" },
      documentOf,
    )
    expect(result.aggregate.decision).toBe("passed")
    expect(assessments).toHaveLength(1)
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

  it("generates two angle-specific CMS-compatible drafts without evaluating them", async () => {
    const edition = editionInput("d".repeat(64))
    const { assessments, client, drafts } = depsWith(edition)
    const result = await runGenerationOperation({ client, provider: createFakeProvider() }, input)
    expect(result.outcomes).toEqual([{ editionId: 101 }, { editionId: 102 }])
    expect(drafts).toHaveLength(2)
    expect(drafts[0]?.body[0]).toEqual({
      blockType: "heading",
      level: "2",
      text: "The Practitioner Playbook for Deterministic Content",
    })
    expect(assessments).toHaveLength(0)
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

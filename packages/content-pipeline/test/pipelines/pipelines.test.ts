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
  sites: [1],
  siteId: 1,
  summary: "How deterministic gates protect releases.",
  tenantId: 7,
  title: "Deterministic release gates",
  workflowRevision: 0,
  workflowStatus: "draft",
})

const depsWith = (edition: EditionInput) => {
  const drafts: { body: unknown[]; title: string }[] = []
  const assessments: {
    issues: { code: string; severity: string }[]
    siteId?: number
    state: string
  }[] = []
  const client = {
    findSimilarEditions: vi.fn(async () => []),
    getEditionInput: vi.fn(async () => edition),
    recordAssessment: vi.fn(
      async (
        _editionId: number,
        request: {
          issues: { code: string; severity: string }[]
          siteId?: number
          state: string
        },
      ) => {
        assessments.push({ issues: request.issues, siteId: request.siteId, state: request.state })
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
    expect(evaluation.perSite).toHaveLength(1)
    expect(evaluation.perSite[0]?.aggregate.decision).toBe("passed")
    expect(evaluation.assessmentIds).toHaveLength(1)
    expect(evaluation.assessmentIds[0]).toBeGreaterThan(0)
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
    expect(evaluation.perSite[0]?.aggregate.decision).toBe("blocked")
    expect(evaluation.perSite[0]?.aggregate.gate.reasons).toContain("GATE_LAYER_ERROR")
    expect(assessments[0]?.state).toBe("error")
  })

  it("A3：按成员站扇出，每站一条评估且按各站阈值独立判定", async () => {
    const edition = editionInput("e".repeat(64))
    const { assessments, client } = depsWith(edition)
    const evaluation = await evaluateEdition(
      { client, provider: createFakeProvider() },
      {
        document: documentOf(edition),
        editionId: 101,
        siteAngle: "a",
        siteName: "s",
        sites: [
          {
            crossDomainBlock: 0.92,
            crossDomainReview: 0.85,
            // fake 输出 overall 88 / 最低维度 85 → 本站阈值内通过
            dimensionMin: 75,
            overallMin: 80,
            sameSiteTitleBlock: 0.9,
            siteId: 1,
          },
          {
            crossDomainBlock: 0.92,
            crossDomainReview: 0.85,
            // 本站更严（95/90）→ 同一份 LLM 打分在本站不达标
            dimensionMin: 90,
            overallMin: 95,
            sameSiteTitleBlock: 0.9,
            siteId: 2,
          },
        ],
      },
    )
    expect(evaluation.perSite).toHaveLength(2)
    expect(evaluation.perSite[0]?.siteId).toBe(1)
    expect(evaluation.perSite[0]?.aggregate.assessmentState).toBe("passed")
    expect(evaluation.perSite[1]?.siteId).toBe(2)
    expect(evaluation.perSite[1]?.aggregate.assessmentState).toBe("failed")
    expect(evaluation.perSite[1]?.aggregate.gate.reasons).toContain("GATE_BLOCKED_LLM_THRESHOLD")
    // 每站一条 assessment，siteId 落到该站
    expect(assessments.map((row) => row.siteId)).toEqual([1, 2])
    expect(assessments.map((row) => row.state)).toEqual(["passed", "failed"])
    // 两个站点各存一次 title/content 向量（4 次 storeEmbedding）
    expect(client.storeEmbedding).toHaveBeenCalledTimes(4)
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
    expect(result.perSite[0]?.aggregate.decision).toBe("passed")
    expect(assessments).toHaveLength(1)
  })

  it("A3：payload 带 sites 快照时按快照扇出，缺省时回退单数站点", async () => {
    const edition = editionInput("1".repeat(64))
    const { assessments, client } = depsWith(edition)
    const result = await runEvaluationOperation(
      { client, provider: createFakeProvider() },
      {
        attempt: 1,
        editionId: 101,
        operationId: "op-0002-abcd",
        sites: [
          {
            crossDomainBlock: 0.92,
            crossDomainReview: 0.85,
            dimensionMin: 75,
            overallMin: 80,
            sameSiteTitleBlock: 0.9,
            siteId: 7,
          },
          {
            crossDomainBlock: 0.92,
            crossDomainReview: 0.85,
            dimensionMin: 75,
            overallMin: 80,
            sameSiteTitleBlock: 0.9,
            siteId: 8,
          },
        ],
      },
      documentOf,
    )
    expect(result.assessmentIds).toHaveLength(2)
    expect(assessments.map((row) => row.siteId)).toEqual([7, 8])
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

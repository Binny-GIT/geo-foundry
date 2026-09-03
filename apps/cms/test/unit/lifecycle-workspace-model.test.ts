import { describe, expect, it } from "vitest"

import {
  editionReadinessFor,
  lifecycleWorkspaceQueues,
  operationTimelineDisplayOf,
  type RecordLike,
  releaseHistoryForSite,
  rollbackCandidatesForSite,
  workspaceEditionDtoOf,
} from "../../src/components/workspaces/lifecycle-workspace-model"

describe("lifecycle workspace model", () => {
  it("builds editor, reviewer, and publisher queues from lifecycle state without mutating input", () => {
    const editions: RecordLike[] = [
      { id: 1, title: "Draft", updatedAt: "2026-08-25T10:00:00.000Z", workflowStatus: "draft" },
      {
        id: 2,
        title: "Generating",
        updatedAt: "2026-08-26T10:00:00.000Z",
        workflowStatus: "generating",
      },
      { id: 3, title: "Review", workflowStatus: "review" },
      { id: 4, title: "Compiled", workflowStatus: "compiled" },
      { id: 5, title: "Approved", workflowStatus: "approved" },
      { id: 6, title: "Invalid", workflowStatus: "not-a-state" },
    ]
    const before = structuredClone(editions)

    const queues = lifecycleWorkspaceQueues(editions)

    expect(queues.editor.map((edition) => edition.editionId)).toEqual(["2", "1"])
    expect(queues.reviewer.map((edition) => edition.editionId)).toEqual(["3"])
    expect(queues.publisher.map((edition) => edition.editionId)).toEqual(["4", "5"])
    expect(editions).toEqual(before)
  })

  it("provides lifecycle readiness without exposing a mutation or access decision", () => {
    expect(editionReadinessFor("draft")).toEqual({
      kind: "actionable",
      nextOwner: "editor",
      state: "draft",
    })
    expect(editionReadinessFor("review")).toEqual({
      kind: "actionable",
      nextOwner: "reviewer",
      state: "review",
    })
    expect(editionReadinessFor("compiled")).toEqual({
      kind: "actionable",
      nextOwner: "publisher",
      state: "compiled",
    })
    expect(editionReadinessFor("published")).toEqual({
      kind: "complete",
      nextOwner: null,
      state: "published",
    })
  })

  it("normalizes only valid Payload-shaped edition rows and preserves supplied tenant identity", () => {
    expect(
      workspaceEditionDtoOf({
        id: 22,
        site: { id: 11 },
        tenant: { id: 7 },
        title: "Tenant seven edition",
        workflowStatus: "review",
      }),
    ).toMatchObject({ editionId: "22", siteId: "11", tenantId: "7", workflowStatus: "review" })
    expect(workspaceEditionDtoOf({ id: 22, workflowStatus: "unknown" })).toBeNull()
  })

  it("renders chronological operation timeline entries while ignoring malformed audit data", () => {
    const operation = {
      auditLog: [
        {
          action: "operation.stage.completed:upload",
          at: "2026-08-26T09:02:00.000Z",
          detail: { outcome: "succeeded" },
        },
        {
          action: "operation.created",
          at: "2026-08-26T09:00:00.000Z",
          actor: { role: "publisher" },
        },
        { action: "operation.stage.started:upload", at: "2026-08-26T09:01:00.000Z" },
        { action: 4, at: "2026-08-26T09:03:00.000Z" },
      ],
      currentStage: "upload",
      operationId: "operation-1",
      operationType: "publish",
      state: "running",
    }

    expect(operationTimelineDisplayOf(operation)).toEqual({
      currentStage: "upload",
      operationId: "operation-1",
      operationType: "publish",
      state: "running",
      timeline: [
        {
          action: "operation.created",
          actorRole: "publisher",
          at: "2026-08-26T09:00:00.000Z",
          outcome: null,
          stage: null,
        },
        {
          action: "operation.stage.started:upload",
          actorRole: null,
          at: "2026-08-26T09:01:00.000Z",
          outcome: null,
          stage: "upload",
        },
        {
          action: "operation.stage.completed:upload",
          actorRole: null,
          at: "2026-08-26T09:02:00.000Z",
          outcome: "succeeded",
          stage: "upload",
        },
      ],
    })
  })

  it("keeps release history site-scoped and offers only prior stable records as rollback candidates", () => {
    const releases: RecordLike[] = [
      {
        createdAt: "2026-08-26T12:00:00.000Z",
        manifestSha256: "current",
        releaseId: "r3",
        site: 1,
        state: "current",
        tenant: 10,
      },
      {
        createdAt: "2026-08-25T12:00:00.000Z",
        manifestSha256: "stable",
        releaseId: "r2",
        site: 1,
        state: "superseded",
        tenant: 10,
      },
      {
        createdAt: "2026-08-24T12:00:00.000Z",
        manifestSha256: "old",
        releaseId: "r1",
        site: 1,
        state: "rolled_back",
        tenant: 10,
      },
      {
        createdAt: "2026-08-23T12:00:00.000Z",
        manifestSha256: "unsafe",
        releaseId: "r0",
        site: 1,
        state: "failed",
        tenant: 10,
      },
      {
        createdAt: "2026-08-26T13:00:00.000Z",
        manifestSha256: "foreign",
        releaseId: "other",
        site: 2,
        state: "current",
        tenant: 99,
      },
    ]

    expect(releaseHistoryForSite(releases, 1, 10).map((release) => release.releaseId)).toEqual([
      "r3",
      "r2",
      "r1",
      "r0",
    ])
    expect(rollbackCandidatesForSite(releases, "1", 10)).toEqual([
      expect.objectContaining({ currentReleaseId: "r3", releaseId: "r2", state: "superseded" }),
      expect.objectContaining({ currentReleaseId: "r3", releaseId: "r1", state: "rolled_back" }),
    ])
  })

  it("does not infer a rollback target when the caller supplies no current release", () => {
    expect(
      rollbackCandidatesForSite(
        [
          { releaseId: "prior", site: 1, state: "superseded" },
          { releaseId: "building", site: 1, state: "building" },
        ],
        1,
        10,
      ),
    ).toEqual([])
  })
})

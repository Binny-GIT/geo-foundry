import { describe, expect, it } from "vitest"

import { editionHistoryItemOf } from "../../src/server/repositories/edition-versions"
import type { editionVersions } from "../../src/server/db/edition-schema"

const versionRow = (
  overrides: Partial<typeof editionVersions.$inferSelect> = {},
): typeof editionVersions.$inferSelect => ({
  angle: "historical angle",
  auditLog: [],
  bodyMarkdown: "Historical body",
  citations: [{ id: "citation-1", title: "Source", url: "https://example.com" }],
  compiledRelease: null,
  contentId: 1,
  contentModifiedAt: new Date("2026-09-08T00:00:00.000Z"),
  createdAt: new Date("2026-09-08T00:00:00.000Z"),
  creationOrigin: "human",
  dueAt: null,
  editorialStatus: "unassigned",
  entities: [{ id: "entity-1", name: "Entity", type: "topic" }],
  id: 100,
  latest: true,
  ownerId: null,
  parentId: 50,
  primaryTopic: "historical topic",
  priority: "normal",
  siteId: 2,
  status: "draft",
  summary: "Historical summary",
  tenantId: 3,
  title: "Historical title",
  updatedAt: new Date("2026-09-08T00:01:00.000Z"),
  versionCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
  versionUpdatedAt: new Date("2026-09-08T00:01:00.000Z"),
  workflowRevision: "2",
  workflowStatus: "draft",
  ...overrides,
})

describe("edition version history DTO", () => {
  it("derives body from Markdown and exposes only the safe historical snapshot", () => {
    const item = editionHistoryItemOf(versionRow(), ["one", "two"])
    expect(item).toEqual({
      createdAt: "2026-09-08T00:00:00.000Z",
      draft: true,
      id: 100,
      latest: true,
      snapshot: {
        angle: "historical angle",
        body: [{ blockType: "paragraph", text: "Historical body" }],
        bodyMarkdown: "Historical body",
        citations: [{ id: "citation-1", title: "Source", url: "https://example.com" }],
        creationOrigin: "human",
        entities: [{ id: "entity-1", name: "Entity", type: "topic" }],
        primaryTopic: "historical topic",
        secondaryTopics: ["one", "two"],
        summary: "Historical summary",
        title: "Historical title",
      },
      updatedAt: "2026-09-08T00:01:00.000Z",
      workflowStatus: "draft",
    })
  })

  it("keeps valid early drafts whose optional article information is empty", () => {
    const item = editionHistoryItemOf(
      versionRow({
        angle: "",
        bodyMarkdown: "E2E 验证占位段落",
        citations: null,
        entities: null,
        primaryTopic: "",
        summary: "",
        title: "E2E 新建文章验证（可删除）",
      }),
      [],
    )
    expect(item.snapshot).toMatchObject({
      angle: "",
      body: [{ blockType: "paragraph", text: "E2E 验证占位段落" }],
      bodyMarkdown: "E2E 验证占位段落",
      primaryTopic: "",
      summary: "",
    })
  })
})

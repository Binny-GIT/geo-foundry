import { describe, expect, it } from "vitest"

import {
  editionVersionSnapshotOf,
  restorableEditionFieldsOf,
} from "../../src/services/edition-version-history"

describe("edition draft restore model", () => {
  it("restores the Markdown truth and only explicitly editable content fields", () => {
    const fields = restorableEditionFieldsOf({
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
    })

    expect(fields).toEqual({
      angle: "historical angle",
      bodyMarkdown: "Historical body",
      citations: [{ id: "citation-1", title: "Source", url: "https://example.com" }],
      creationOrigin: "human",
      entities: [{ id: "entity-1", name: "Entity", type: "topic" }],
      primaryTopic: "historical topic",
      secondaryTopics: ["one", "two"],
      summary: "Historical summary",
      title: "Historical title",
    })
    expect(fields).not.toHaveProperty("body")
    expect(fields).not.toHaveProperty("workflowStatus")
    expect(fields).not.toHaveProperty("workflowRevision")
    expect(fields).not.toHaveProperty("compiledRelease")
    expect(fields).not.toHaveProperty("auditLog")
    expect(fields).not.toHaveProperty("tenant")
  })

  it("keeps valid early drafts whose optional article information is still empty", () => {
    const snapshot = editionVersionSnapshotOf({
      angle: "",
      bodyMarkdown: "E2E 验证占位段落",
      citations: null,
      creationOrigin: "human",
      entities: null,
      primaryTopic: "",
      secondaryTopics: [],
      summary: "",
      title: "E2E 新建文章验证（可删除）",
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot).toMatchObject({
      angle: "",
      body: [{ blockType: "paragraph", text: "E2E 验证占位段落" }],
      bodyMarkdown: "E2E 验证占位段落",
      primaryTopic: "",
      summary: "",
    })
  })
})

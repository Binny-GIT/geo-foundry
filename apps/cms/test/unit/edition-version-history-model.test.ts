import { describe, expect, it } from "vitest"

import { restorableEditionFieldsOf } from "../../src/services/edition-version-history"

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
})

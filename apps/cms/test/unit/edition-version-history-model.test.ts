import { describe, expect, it } from "vitest"

import { restorableEditionFieldsOf } from "../../src/services/edition-version-history"

describe("edition draft restore model", () => {
  it("copies only explicitly editable content fields into a new draft", () => {
    const fields = restorableEditionFieldsOf({
      angle: "historical angle",
      body: [{ blockType: "paragraph", text: "Historical body" }],
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
      body: [{ blockType: "paragraph", text: "Historical body" }],
      citations: [{ id: "citation-1", title: "Source", url: "https://example.com" }],
      creationOrigin: "human",
      entities: [{ id: "entity-1", name: "Entity", type: "topic" }],
      primaryTopic: "historical topic",
      secondaryTopics: ["one", "two"],
      summary: "Historical summary",
      title: "Historical title",
    })
    expect(fields).not.toHaveProperty("workflowStatus")
    expect(fields).not.toHaveProperty("workflowRevision")
    expect(fields).not.toHaveProperty("compiledRelease")
    expect(fields).not.toHaveProperty("auditLog")
    expect(fields).not.toHaveProperty("tenant")
  })
})

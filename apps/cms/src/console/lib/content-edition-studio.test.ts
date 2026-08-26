import { describe, expect, it } from "vitest"

import {
  EDITION_EDITABLE_FIELDS,
  editableContentEditionPayload,
  mapContentEditionDocument,
} from "./content-edition-studio"

describe("Console Content Edition Studio mappings", () => {
  it("maps draft REST records while normalizing relationships and preserving raw block and JSON values", () => {
    const document = mapContentEditionDocument({
      angle: "Operations guide",
      body: [{ blockType: "paragraph", text: "Keep raw blocks." }],
      citations: [{ id: "cite-1" }],
      content: { id: 42, topic: "Operations" },
      creationOrigin: "hybrid",
      entities: { organizations: ["Geo Foundry"] },
      id: 18,
      primaryTopic: "operations",
      secondaryTopics: ["release", 7, " workflow "],
      site: { id: "site-9", name: "Northstar" },
      summary: "A concise summary.",
      title: "Edition title",
      workflowRevision: 4,
      workflowStatus: "review",
    })

    expect(document).toMatchObject({
      content: "42",
      id: "18",
      site: "site-9",
      secondaryTopics: ["release", "workflow"],
      workflowRevision: 4,
      workflowStatus: "review",
    })
    expect(document.body).toEqual([{ blockType: "paragraph", text: "Keep raw blocks." }])
    expect(document.citations).toEqual([{ id: "cite-1" }])
    expect(document.entities).toEqual({ organizations: ["Geo Foundry"] })
  })

  it("emits only explicitly editable edition fields for REST create and draft patch", () => {
    const payload = editableContentEditionPayload({
      angle: "  Angle  ",
      body: [{ blockType: "paragraph", text: "Draft body" }],
      citations: { sources: [] },
      content: "content-1",
      creationOrigin: "human",
      entities: null,
      primaryTopic: "  primary  ",
      secondaryTopics: [" one ", "", " two "],
      site: "site-1",
      summary: "  Summary  ",
      title: "  Title  ",
    })

    expect(Object.keys(payload).sort()).toEqual([...EDITION_EDITABLE_FIELDS].sort())
    expect(payload).toMatchObject({
      angle: "Angle",
      primaryTopic: "primary",
      secondaryTopics: ["one", "two"],
      summary: "Summary",
      title: "Title",
    })
    expect(payload).not.toHaveProperty("tenant")
    expect(payload).not.toHaveProperty("workflowStatus")
    expect(payload).not.toHaveProperty("workflowRevision")
    expect(payload).not.toHaveProperty("compiledRelease")
    expect(payload).not.toHaveProperty("auditLog")
    expect(payload).not.toHaveProperty("contentModifiedAt")
  })
})

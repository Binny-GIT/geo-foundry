import { describe, expect, it } from "vitest"

import { PageDocumentJsonSchema } from "../src/index.js"

describe("PageDocument JSON Schema export", () => {
  it("exports a serializable draft 2020-12 schema", () => {
    // Given: the public in-memory JSON Schema export.
    // When: a consumer serializes and restores it.
    const restored = JSON.parse(JSON.stringify(PageDocumentJsonSchema))

    // Then: the artifact identifies the contract and its target draft.
    expect(restored).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://schemas.geo-foundry.dev/page-document/v1",
      title: "Geo Foundry PageDocument v1",
    })
  })

  it("preserves strict-object rejection in the export", () => {
    // Given: the serialized public JSON Schema.
    // When: consumers inspect object closure constraints.
    const serialized = JSON.stringify(PageDocumentJsonSchema)

    // Then: strict variants emit additionalProperties false.
    expect(serialized).toContain('"additionalProperties":false')
  })
})

import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { articlePageFixture, PageDocumentSchema } from "../src/index.js"

describe("PageDocument serialization properties", () => {
  it("round-trips namespaced JSON extension values", () => {
    // Given: arbitrary JSON data under a valid namespace.
    const property = fc.property(fc.jsonValue(), (extensionValue) => {
      const input = {
        ...articlePageFixture,
        extensions: { "vendor.example/property": extensionValue },
      }

      // When: the document crosses parse, JSON serialization, and parse again.
      const first = PageDocumentSchema.parse(input)
      const serialized = JSON.stringify(first)
      const second = PageDocumentSchema.parse(JSON.parse(serialized))

      // Then: the extension and document remain equivalent.
      expect(JSON.stringify(second)).toBe(serialized)
    })

    fc.assert(property, { numRuns: 100 })
  })

  it("rejects arbitrary unnamespaced extension keys", () => {
    // Given: extension keys that cannot match the required namespace grammar.
    const property = fc.property(fc.stringMatching(/^[A-Z_]{1,12}$/), (extensionKey) => {
      const input = { ...articlePageFixture, extensions: { [extensionKey]: true } }

      // When: the document boundary parses the extension record.
      const result = PageDocumentSchema.safeParse(input)

      // Then: every generated invalid key is rejected.
      expect(result.success).toBe(false)
    })

    fc.assert(property, { numRuns: 100 })
  })
})

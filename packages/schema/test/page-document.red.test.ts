import { describe, expect, it } from "vitest"

import {
  migratePageDocument,
  PageDocumentSchema,
  UnsupportedPageDocumentVersionError,
} from "../src/index.js"
import {
  invalidExtensionNamespaceInput,
  malformedHeadingInput,
  unknownBlockFieldInput,
  unknownRootInput,
  unsupportedVersionInputs,
} from "./red-fixtures.js"

describe("PageDocument v1 strict contract", () => {
  it.each(unsupportedVersionInputs)(
    "rejects unsupported schema version $schemaVersion with a typed error",
    (input) => {
      // Given: a complete document carrying an unsupported version.
      // When: migration is requested.
      const migrate = () => migratePageDocument(input)

      // Then: callers receive the stable typed version error.
      expect(migrate).toThrow(UnsupportedPageDocumentVersionError)
      try {
        migrate()
        expect.unreachable("migration accepted an unsupported version")
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedPageDocumentVersionError)
        if (error instanceof UnsupportedPageDocumentVersionError) {
          expect(error.code).toBe("PAGE_DOCUMENT_SCHEMA_VERSION_UNSUPPORTED")
          expect(error.receivedVersion).toBe(input.schemaVersion)
        }
      }
    },
  )

  it("rejects unknown root fields", () => {
    // Given: a valid document with an undeclared root field.
    // When: the strict schema parses it.
    const result = PageDocumentSchema.safeParse(unknownRootInput)

    // Then: the root field is rejected.
    expect(result.success).toBe(false)
  })

  it("rejects unknown block fields", () => {
    // Given: a paragraph with an undeclared field.
    // When: the strict schema parses it.
    const result = PageDocumentSchema.safeParse(unknownBlockFieldInput)

    // Then: the block field is rejected.
    expect(result.success).toBe(false)
  })

  it("rejects a malformed heading level", () => {
    // Given: a heading with level one.
    // When: the strict schema parses it.
    const result = PageDocumentSchema.safeParse(malformedHeadingInput)

    // Then: heading validation reports the level path.
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["body", 0, "level"])
    }
  })

  it("rejects an extension key without a namespace", () => {
    // Given: extension data under a non-namespaced key.
    // When: the strict schema parses it.
    const result = PageDocumentSchema.safeParse(invalidExtensionNamespaceInput)

    // Then: extension validation reports the invalid key path.
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["extensions", "editorialScore"])
    }
  })
})

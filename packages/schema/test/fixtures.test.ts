import { describe, expect, it } from "vitest"

import {
  canonicalPageFixtures,
  ContentBlockSchema,
  invalidBlockFixtures,
  migratePageDocument,
  pageDocumentMigrationRegistry,
  PageDocumentSchema,
  validBlockFixtures,
} from "../src/index.js"

describe("canonical PageDocument fixtures", () => {
  it.each(canonicalPageFixtures)("round-trips the $pageType page", (fixture) => {
    // Given: a parsed canonical page fixture.
    const serialized = JSON.stringify(fixture)

    // When: consumers parse its serialized representation.
    const parsed = PageDocumentSchema.parse(JSON.parse(serialized))

    // Then: no contract information is lost.
    expect(parsed).toEqual(fixture)
  })

  it("covers every required page type", () => {
    // Given: the public canonical fixture collection.
    const pageTypes = canonicalPageFixtures.map((fixture) => fixture.pageType)

    // When: consumers inspect its discriminators.
    const uniquePageTypes = new Set(pageTypes)

    // Then: all P0 variants are represented exactly once.
    expect(uniquePageTypes).toEqual(
      new Set(["article", "article-list", "category", "tag", "redirect", "not-found"]),
    )
  })

  it("performs a pure v1 identity migration", () => {
    // Given: a canonical v1 document.
    const fixture = canonicalPageFixtures[0]

    // When: the registry migrates it to the latest internal type.
    const migrated = migratePageDocument(fixture)

    // Then: values are equivalent and the input is not mutated.
    expect(migrated).toEqual(fixture)
    expect(migrated).not.toBe(fixture)
  })

  it("exposes an immutable v1-only migration registry", () => {
    // Given: the public migration registry.
    // When: consumers inspect its supported versions.
    const versions = Object.keys(pageDocumentMigrationRegistry)

    // Then: only v1 exists and the registry cannot be mutated.
    expect(versions).toEqual(["1"])
    expect(Object.isFrozen(pageDocumentMigrationRegistry)).toBe(true)
  })

  it("rejects undeclared structured-data fields outside extensions", () => {
    // Given: a structured-data node carrying arbitrary unknown data.
    const input = {
      ...canonicalPageFixtures[0],
      structuredData: [
        {
          type: "Article",
          headline: "Article",
          url: "https://site-a.test/guides/article",
          arbitrary: true,
        },
      ],
    }

    // When: the document boundary parses it.
    const result = PageDocumentSchema.safeParse(input)

    // Then: unknown data cannot escape the extensions record.
    expect(result.success).toBe(false)
  })
})

describe("canonical content block fixtures", () => {
  it.each(validBlockFixtures)("accepts the $type block", (fixture) => {
    // Given: one canonical block variant.
    // When: the block boundary parses it.
    const result = ContentBlockSchema.safeParse(fixture)

    // Then: the variant is accepted.
    expect(result.success).toBe(true)
  })

  it.each(Object.entries(invalidBlockFixtures))(
    "rejects both invalid $0 fixtures",
    (_blockType, fixtures) => {
      // Given: two invalid inputs for the same block discriminator.
      // When: each input crosses the block boundary.
      const results = fixtures.map((fixture) => ContentBlockSchema.safeParse(fixture))

      // Then: both invalid forms are rejected.
      expect(results).toHaveLength(2)
      expect(results.every((result) => !result.success)).toBe(true)
    },
  )

  it("rejects an unknown block discriminator", () => {
    // Given: a structurally plausible but undeclared block.
    const input = { type: "html", html: "<p>Arbitrary HTML</p>" }

    // When: the block boundary parses it.
    const result = ContentBlockSchema.safeParse(input)

    // Then: unknown blocks cannot extend the node set.
    expect(result.success).toBe(false)
  })

  it("rejects a block extension without a namespace", () => {
    // Given: a valid paragraph with an invalid extension key.
    const input = {
      type: "paragraph",
      text: "Strict extension boundary.",
      extensions: { theme: "lead" },
    }

    // When: the block boundary parses it.
    const result = ContentBlockSchema.safeParse(input)

    // Then: block extensions use the same namespace grammar as root extensions.
    expect(result.success).toBe(false)
  })

  it("rejects arbitrary HTML as the sole body representation", () => {
    // Given: an article whose body is an HTML string.
    const input = { ...canonicalPageFixtures[0], body: "<p>Arbitrary HTML</p>" }

    // When: the document boundary parses it.
    const result = PageDocumentSchema.safeParse(input)

    // Then: only structured content block arrays are accepted.
    expect(result.success).toBe(false)
  })
})

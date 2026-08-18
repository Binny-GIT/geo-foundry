import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import { PageDocumentSchema } from "../src/index.js"
import { validArticleInput } from "./red-fixtures.js"

const generatedJsonSchema = JSON.parse(
  readFileSync(new URL("../dist/page-document.schema.json", import.meta.url), "utf8"),
)

const validator = new Ajv2020({ strict: false, validateFormats: true })
addFormats(validator)

expect(validator.constructor.name).toBe("Ajv2020")
expect(validator.getSchema("https://json-schema.org/draft/2020-12/schema")).toBeDefined()
expect(validator.validateSchema(generatedJsonSchema)).toBe(true)
const validateJsonSchema = validator.compile(generatedJsonSchema)

describe("PageDocument public URL contract", () => {
  it.each([
    ["http://site-a.test/guides/geo-foundry", true],
    ["https://site-a.test/guides/geo-foundry", true],
    ["ftp://site-a.test/guides/geo-foundry", false],
    ["mailto:editor@site-a.test", false],
    ["geo-foundry:page-guide", false],
    ["https:site-a.test/guides/geo-foundry", false],
  ])("makes the same decision for canonical URL %s", (canonicalUrl, expected) => {
    // Given: a canonical PageDocument carrying the candidate URL.
    const input = {
      ...validArticleInput,
      route: { ...validArticleInput.route, canonicalUrl },
    }

    // When: consumers validate through both public contracts.
    const zodAccepted = PageDocumentSchema.safeParse(input).success
    const jsonSchemaAccepted = validateJsonSchema(input)

    // Then: both contracts enforce the HTTP/HTTPS-only decision.
    expect({ jsonSchemaAccepted, zodAccepted }).toEqual({
      jsonSchemaAccepted: expected,
      zodAccepted: expected,
    })
  })
})

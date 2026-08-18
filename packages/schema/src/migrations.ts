import { z } from "zod"

import { PageDocumentSchema, type PageDocument } from "./page-document/v1/index.js"

const SchemaVersionProbeSchema = z.looseObject({
  schemaVersion: z.number().int(),
})

type PageDocumentMigration = (input: unknown) => PageDocument

export class UnsupportedPageDocumentVersionError extends Error {
  override readonly name = "UnsupportedPageDocumentVersionError"
  readonly code = "PAGE_DOCUMENT_SCHEMA_VERSION_UNSUPPORTED"

  constructor(readonly receivedVersion: number) {
    super(`Unsupported PageDocument schema version: ${receivedVersion}`)
  }
}

export const pageDocumentMigrationRegistry = Object.freeze({
  1: ((input: unknown) => PageDocumentSchema.parse(input)) satisfies PageDocumentMigration,
})

export function migratePageDocument(input: unknown): PageDocument {
  const { schemaVersion } = SchemaVersionProbeSchema.parse(input)
  if (schemaVersion !== 1) {
    throw new UnsupportedPageDocumentVersionError(schemaVersion)
  }
  return pageDocumentMigrationRegistry[1](input)
}

import { z } from "zod"

import { ReleaseIdSchema, SiteIdSchema } from "../../page-document/v1/primitives.js"
import { ImmutableArtifactSchema } from "./artifact.js"
import {
  CanonicalTimestampSchema,
  CompilerVersionSchema,
  RELEASE_SCHEMA_VERSION,
  Sha256Schema,
  SourceVersionIdSchema,
} from "./primitives.js"

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return 1
}

const ReleaseManifestInputSchema = z
  .strictObject({
    compilerVersion: CompilerVersionSchema,
    createdAt: CanonicalTimestampSchema,
    objects: z.array(ImmutableArtifactSchema).min(1).readonly(),
    releaseId: ReleaseIdSchema,
    schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
    siteId: SiteIdSchema,
    sourceVersionIds: z.array(SourceVersionIdSchema).min(1).readonly(),
  })
  .superRefine((manifest, context) => {
    const objectPaths = new Set<string>()
    for (const [index, artifact] of manifest.objects.entries()) {
      if (objectPaths.has(artifact.path)) {
        context.addIssue({
          code: "custom",
          message: "RELEASE_OBJECT_PATH_DUPLICATE",
          path: ["objects", index, "path"],
        })
      }
      objectPaths.add(artifact.path)
    }

    const sourceVersionIds = new Set<string>()
    for (const [index, sourceVersionId] of manifest.sourceVersionIds.entries()) {
      if (sourceVersionIds.has(sourceVersionId)) {
        context.addIssue({
          code: "custom",
          message: "RELEASE_SOURCE_VERSION_DUPLICATE",
          path: ["sourceVersionIds", index],
        })
      }
      sourceVersionIds.add(sourceVersionId)
    }
  })

export const ReleaseManifestSchema = ReleaseManifestInputSchema.transform((manifest) =>
  Object.freeze({
    compilerVersion: manifest.compilerVersion,
    createdAt: manifest.createdAt,
    objects: Object.freeze(
      [...manifest.objects].sort((left, right) => compareCanonicalText(left.path, right.path)),
    ),
    releaseId: manifest.releaseId,
    schemaVersion: manifest.schemaVersion,
    siteId: manifest.siteId,
    sourceVersionIds: Object.freeze([...manifest.sourceVersionIds].sort(compareCanonicalText)),
  }),
)

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>

export function canonicalizeReleaseManifest(input: unknown): ReleaseManifest {
  return ReleaseManifestSchema.parse(input)
}

export function serializeReleaseManifest(input: unknown): Uint8Array {
  const manifest = canonicalizeReleaseManifest(input)
  return new TextEncoder().encode(JSON.stringify(manifest))
}

export async function hashReleaseManifest(input: unknown): Promise<z.infer<typeof Sha256Schema>> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(serializeReleaseManifest(input)),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
  return Sha256Schema.parse(hex)
}

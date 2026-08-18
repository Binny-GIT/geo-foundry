import { z } from "zod"

import { IdentifierSchema, type ReleaseId, type SiteId } from "../../page-document/v1/primitives.js"

const RELEASE_ARTIFACT_PATH_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)*$/
const IDENTIFIER_FRAGMENT = "[a-z0-9]+(?:[-_][a-z0-9]+)*"
const RELEASE_KEY_PREFIX_PATTERN = new RegExp(
  `^sites/${IDENTIFIER_FRAGMENT}/releases/${IDENTIFIER_FRAGMENT}/(.+)$`,
)
const CURRENT_POINTER_KEY_PATTERN = new RegExp(
  `^sites/${IDENTIFIER_FRAGMENT}/channels/current\\.json$`,
)
const RELEASE_PREFIX_PATTERN = new RegExp(
  `^sites/${IDENTIFIER_FRAGMENT}/releases/${IDENTIFIER_FRAGMENT}/$`,
)

export const RELEASE_SCHEMA_VERSION = 1 as const
export const ARTIFACT_CREATE_CONDITION = "if-none-match-star" as const

export const SourceVersionIdSchema = IdentifierSchema.brand("SourceVersionId")
export const CompilerVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  .brand("CompilerVersion")
export const CanonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((timestamp) => {
    const epochMilliseconds = Date.parse(timestamp)
    return (
      Number.isFinite(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === timestamp
    )
  })
  .brand("CanonicalTimestamp")
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("Sha256")
export const ContentTypeSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:; charset=[a-z0-9._-]+)?$/)
  .brand("ContentType")
export const ETagSchema = z
  .string()
  .regex(/^"[^"\r\n]+"$/)
  .brand("ETag")
export const ReleaseArtifactPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(RELEASE_ARTIFACT_PATH_PATTERN)
  .refine(
    (path) =>
      path !== "manifest.json" && path.split("/").every((part) => part !== "." && part !== ".."),
  )
  .brand("ReleaseArtifactPath")
export const ReleaseObjectKeySchema = z
  .string()
  .regex(RELEASE_KEY_PREFIX_PATTERN)
  .refine((key) => {
    const relativePath = key.split("/").slice(4).join("/")
    return (
      relativePath === "manifest.json" || ReleaseArtifactPathSchema.safeParse(relativePath).success
    )
  })
  .brand("ReleaseObjectKey")
export const CurrentPointerKeySchema = z
  .string()
  .regex(CURRENT_POINTER_KEY_PATTERN)
  .brand("CurrentPointerKey")
export const ArtifactStoreKeySchema = z.union([ReleaseObjectKeySchema, CurrentPointerKeySchema])
export const ReleasePrefixSchema = z.string().regex(RELEASE_PREFIX_PATTERN).brand("ReleasePrefix")

const ActorIdSchema = IdentifierSchema.brand("AuditActorId")

export const AuditActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ actorId: ActorIdSchema, kind: z.literal("user") }).readonly(),
  z.strictObject({ actorId: ActorIdSchema, kind: z.literal("service") }).readonly(),
])

export type SourceVersionId = z.infer<typeof SourceVersionIdSchema>
export type CompilerVersion = z.infer<typeof CompilerVersionSchema>
export type CanonicalTimestamp = z.infer<typeof CanonicalTimestampSchema>
export type Sha256 = z.infer<typeof Sha256Schema>
export type ContentType = z.infer<typeof ContentTypeSchema>
export type ETag = z.infer<typeof ETagSchema>
export type ReleaseArtifactPath = z.infer<typeof ReleaseArtifactPathSchema>
export type ReleaseObjectKey = z.infer<typeof ReleaseObjectKeySchema>
export type ArtifactStoreKey = z.infer<typeof ArtifactStoreKeySchema>
export type CurrentPointerKey = z.infer<typeof CurrentPointerKeySchema>
export type ReleasePrefix = z.infer<typeof ReleasePrefixSchema>
export type AuditActor = z.infer<typeof AuditActorSchema>

export function releaseArtifactKey(
  siteId: SiteId,
  releaseId: ReleaseId,
  path: ReleaseArtifactPath,
): ReleaseObjectKey {
  return ReleaseObjectKeySchema.parse(`sites/${siteId}/releases/${releaseId}/${path}`)
}

export function releaseManifestKey(siteId: SiteId, releaseId: ReleaseId): ReleaseObjectKey {
  return ReleaseObjectKeySchema.parse(`sites/${siteId}/releases/${releaseId}/manifest.json`)
}

export function currentPointerKey(siteId: SiteId): CurrentPointerKey {
  return CurrentPointerKeySchema.parse(`sites/${siteId}/channels/current.json`)
}

export function releasePrefix(siteId: SiteId, releaseId: ReleaseId): ReleasePrefix {
  return ReleasePrefixSchema.parse(`sites/${siteId}/releases/${releaseId}/`)
}

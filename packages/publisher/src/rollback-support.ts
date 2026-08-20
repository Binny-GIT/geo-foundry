import {
  type CurrentPointer,
  CurrentPointerSchema,
  currentPointerKey,
  type ETag,
  type ReleaseManifest,
  ReleaseManifestSchema,
  releaseArtifactKey,
  releaseManifestKey,
  releasePrefix,
  type VerifiedReleaseReference,
  verifyManifest,
} from "@geo/schema/release/v1"

import type { ArtifactStore } from "./artifact-store.js"
import { sha256Of } from "./build-release.js"

export const ROLLBACK_ERROR_CODE = {
  CURRENT_POINTER_UNREADABLE: "ROLLBACK_CURRENT_POINTER_UNREADABLE",
  EXPECTED_CURRENT_MISMATCH: "ROLLBACK_EXPECTED_CURRENT_MISMATCH",
  RELEASE_ALREADY_CURRENT: "ROLLBACK_RELEASE_ALREADY_CURRENT",
  RELEASE_COMPILER_UNSUPPORTED: "ROLLBACK_RELEASE_COMPILER_UNSUPPORTED",
  RELEASE_EXTRA_OBJECT: "ROLLBACK_RELEASE_EXTRA_OBJECT",
  RELEASE_ID_MISMATCH: "ROLLBACK_RELEASE_ID_MISMATCH",
  RELEASE_MANIFEST_HASH_MISMATCH: "ROLLBACK_RELEASE_MANIFEST_HASH_MISMATCH",
  RELEASE_MANIFEST_INVALID: "ROLLBACK_RELEASE_MANIFEST_INVALID",
  RELEASE_MISSING_OBJECT: "ROLLBACK_RELEASE_MISSING_OBJECT",
  RELEASE_OBJECT_BYTES_MISMATCH: "ROLLBACK_RELEASE_OBJECT_BYTES_MISMATCH",
  RELEASE_OBJECT_CONTENT_TYPE_MISMATCH: "ROLLBACK_RELEASE_OBJECT_CONTENT_TYPE_MISMATCH",
  RELEASE_OBJECT_SHA256_MISMATCH: "ROLLBACK_RELEASE_OBJECT_SHA256_MISMATCH",
  RELEASE_POINTER_MISMATCH: "ROLLBACK_RELEASE_POINTER_MISMATCH",
  RELEASE_SITE_MISMATCH: "ROLLBACK_RELEASE_SITE_MISMATCH",
} as const

export type RollbackErrorCode = (typeof ROLLBACK_ERROR_CODE)[keyof typeof ROLLBACK_ERROR_CODE]

export class RollbackError extends Error {
  override readonly name = "RollbackError"

  constructor(
    readonly code: RollbackErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

const decoder = new TextDecoder()

export const pointerOf = async (
  store: ArtifactStore,
  siteId: string,
): Promise<{ readonly etag: ETag; readonly pointer: CurrentPointer }> => {
  let object: Awaited<ReturnType<ArtifactStore["read"]>>
  try {
    object = await store.read({ key: currentPointerKey(siteId as never) })
  } catch {
    throw new RollbackError(ROLLBACK_ERROR_CODE.CURRENT_POINTER_UNREADABLE, siteId)
  }
  let parsed: ReturnType<typeof CurrentPointerSchema.safeParse>
  try {
    parsed = CurrentPointerSchema.safeParse(JSON.parse(decoder.decode(object.body)))
  } catch {
    throw new RollbackError(ROLLBACK_ERROR_CODE.CURRENT_POINTER_UNREADABLE, siteId)
  }
  if (!parsed.success) {
    throw new RollbackError(ROLLBACK_ERROR_CODE.CURRENT_POINTER_UNREADABLE, siteId)
  }
  return { etag: object.etag, pointer: parsed.data as CurrentPointer }
}

export type VerifiedRemoteRelease = {
  readonly manifest: ReleaseManifest
  readonly verifiedManifest: VerifiedReleaseReference
}

const remoteManifestOf = async (
  store: ArtifactStore,
  siteId: string,
  releaseId: string,
): Promise<ReleaseManifest> => {
  let object: Awaited<ReturnType<ArtifactStore["read"]>>
  try {
    object = await store.read({ key: releaseManifestKey(siteId as never, releaseId as never) })
  } catch {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_MISSING_OBJECT, "manifest.json")
  }
  let parsed: ReturnType<typeof ReleaseManifestSchema.safeParse>
  try {
    parsed = ReleaseManifestSchema.safeParse(JSON.parse(decoder.decode(object.body)))
  } catch {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_MANIFEST_INVALID, releaseId)
  }
  if (!parsed.success) {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_MANIFEST_INVALID, releaseId)
  }
  return parsed.data
}

/** Proves the complete remote immutable object inventory before rollback. */
export const verifyRemoteRelease = async (input: {
  readonly expectedManifestSha256: string
  readonly releaseId: string
  readonly siteId: string
  readonly store: ArtifactStore
}): Promise<VerifiedRemoteRelease> => {
  const manifest = await remoteManifestOf(input.store, input.siteId, input.releaseId)
  if (manifest.siteId !== input.siteId) {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_SITE_MISMATCH, manifest.siteId)
  }
  if (manifest.releaseId !== input.releaseId) {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_ID_MISMATCH, manifest.releaseId)
  }
  if (!manifest.compilerVersion.startsWith("1.")) {
    throw new RollbackError(
      ROLLBACK_ERROR_CODE.RELEASE_COMPILER_UNSUPPORTED,
      manifest.compilerVersion,
    )
  }
  const verifiedManifest = await verifyManifest(manifest)
  if (verifiedManifest.manifestSha256 !== input.expectedManifestSha256) {
    throw new RollbackError(
      ROLLBACK_ERROR_CODE.RELEASE_MANIFEST_HASH_MISMATCH,
      `${verifiedManifest.manifestSha256}/${input.expectedManifestSha256}`,
    )
  }
  const expectedKeys = new Set<string>([
    releaseManifestKey(manifest.siteId, manifest.releaseId),
    ...manifest.objects.map((artifact) =>
      releaseArtifactKey(manifest.siteId, manifest.releaseId, artifact.path),
    ),
  ])
  const listed = await input.store.list({
    prefix: releasePrefix(manifest.siteId, manifest.releaseId),
  })
  for (const object of listed) {
    if (!expectedKeys.has(object.key)) {
      throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_EXTRA_OBJECT, object.key)
    }
  }
  for (const expectedKey of expectedKeys) {
    if (!listed.some((object) => object.key === expectedKey)) {
      throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_MISSING_OBJECT, expectedKey)
    }
  }
  for (const artifact of manifest.objects) {
    const key = releaseArtifactKey(manifest.siteId, manifest.releaseId, artifact.path)
    let object: Awaited<ReturnType<ArtifactStore["read"]>>
    try {
      object = await input.store.read({ key })
    } catch {
      throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_MISSING_OBJECT, key)
    }
    if (object.body.byteLength !== artifact.bytes) {
      throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_OBJECT_BYTES_MISMATCH, artifact.path)
    }
    if (object.contentType !== artifact.contentType) {
      throw new RollbackError(
        ROLLBACK_ERROR_CODE.RELEASE_OBJECT_CONTENT_TYPE_MISMATCH,
        artifact.path,
      )
    }
    if (sha256Of(object.body) !== artifact.sha256) {
      throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_OBJECT_SHA256_MISMATCH, artifact.path)
    }
  }
  return { manifest, verifiedManifest }
}

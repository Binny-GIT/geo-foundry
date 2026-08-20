import type { ArtifactStore, ArtifactObjectHead } from "./artifact-store.js"
import {
  createCurrentPointer,
  currentPointerKey,
  CurrentPointerSchema,
  PublishReceiptSchema,
} from "@geo/schema/release/v1"
import type {
  AuditActor,
  ETag,
  PublishReceipt,
  ReleaseManifest,
  VerifiedReleaseReference,
} from "@geo/schema/release/v1"

import { sha256Of, type PlannedRelease } from "./build-release.js"

export const PUBLISH_ERROR_CODE = {
  OBJECT_EXISTS_WITH_DIFFERENT_CONTENT: "PUBLISH_OBJECT_EXISTS_WITH_DIFFERENT_CONTENT",
  POINTER_UNREADABLE: "PUBLISH_POINTER_UNREADABLE",
  REMOTE_VERIFICATION_FAILED: "PUBLISH_REMOTE_VERIFICATION_FAILED",
} as const

export type PublishErrorCode = (typeof PUBLISH_ERROR_CODE)[keyof typeof PUBLISH_ERROR_CODE]

export class PublishError extends Error {
  override readonly name = "PublishError"

  constructor(
    readonly code: PublishErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

const isConditionalConflict = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  const name = error.name
  return (
    name === "PreconditionFailed" ||
    name === "ConditionalRequestConflict" ||
    name === "412" ||
    /conditional/i.test(error.message)
  )
}

const pointerKeyOf = (siteId: string) =>
  currentPointerKey(siteId as never) as ReturnType<typeof currentPointerKey>

/** Release object key of the manifest, e.g. sites/s/releases/r/manifest.json. */
const manifestKeyOf = (manifest: ReleaseManifest) =>
  `sites/${manifest.siteId}/releases/${manifest.releaseId}/manifest.json` as never

const objectKeyOf = (manifest: ReleaseManifest, path: string): string =>
  `sites/${manifest.siteId}/releases/${manifest.releaseId}/${path}` as never

type StoredPointer = ReturnType<typeof CurrentPointerSchema.parse>

const pointerBodyOf = async (
  store: ArtifactStore,
  siteId: string,
): Promise<StoredPointer | null> => {
  const object = await store.read({ key: pointerKeyOf(siteId) as never })
  const parsed = CurrentPointerSchema.safeParse(JSON.parse(new TextDecoder().decode(object.body)))
  if (!parsed.success) {
    throw new PublishError(PUBLISH_ERROR_CODE.POINTER_UNREADABLE, `sites/${siteId} current pointer`)
  }
  return parsed.data
}

export type PublishResult = {
  readonly etag: ETag
  readonly pointer: StoredPointer
  readonly receipt: PublishReceipt
}

/**
 * Conditional publish: every release object is created if absent (a byte-wise
 * identical existing object is accepted as replay), the manifest uploads
 * strictly last, remote bytes are re-verified, and the site pointer switches
 * atomically via create-if-absent or If-Match CAS. The receipt's recordedAt
 * equals the manifest createdAt, so an exact replay yields an identical
 * receipt.
 */
export const publishRelease = async (input: {
  readonly actor: AuditActor
  readonly planned: PlannedRelease
  readonly store: ArtifactStore
  readonly verifiedManifest: VerifiedReleaseReference
}): Promise<PublishResult> => {
  const { actor, planned, store } = input
  const manifest = planned.manifest

  const uploadConditionally = async (
    key: string,
    body: Uint8Array,
    contentType: string,
    sha256: string,
  ): Promise<ArtifactObjectHead> => {
    try {
      return await store.createIfAbsent({
        body,
        condition: "if-none-match-star",
        contentType: contentType as never,
        key: key as never,
        sha256: sha256 as never,
      })
    } catch (error) {
      if (!isConditionalConflict(error)) {
        throw error
      }
      const existing = await store.read({ key: key as never })
      const sameBytes = existing.body.byteLength === body.byteLength
      const sameHash = sha256Of(existing.body) === sha256
      if (!sameBytes || !sameHash) {
        throw new PublishError(
          PUBLISH_ERROR_CODE.OBJECT_EXISTS_WITH_DIFFERENT_CONTENT,
          `${key} exists with different content`,
        )
      }
      const head = await store.head({ key: key as never })
      if (head === null) {
        throw new PublishError(PUBLISH_ERROR_CODE.REMOTE_VERIFICATION_FAILED, key)
      }
      return head
    }
  }

  for (const object of planned.objects) {
    await uploadConditionally(
      objectKeyOf(manifest, object.path),
      object.body,
      object.contentType,
      object.sha256,
    )
  }
  const manifestHead = await uploadConditionally(
    manifestKeyOf(manifest),
    planned.plannedManifest.body,
    planned.plannedManifest.contentType,
    planned.plannedManifest.sha256,
  )
  void manifestHead

  // Remote verification: every uploaded object must be remotely observable
  // with the planned byte count and content type before the pointer moves.
  for (const object of [...planned.objects, planned.plannedManifest]) {
    const key =
      object === planned.plannedManifest
        ? manifestKeyOf(manifest)
        : objectKeyOf(manifest, object.path)
    const head = await store.head({ key: key as never })
    if (head === null) {
      throw new PublishError(
        PUBLISH_ERROR_CODE.REMOTE_VERIFICATION_FAILED,
        `${key} absent after upload`,
      )
    }
    if (head.bytes !== object.bytes || head.contentType !== (object.contentType as never)) {
      throw new PublishError(
        PUBLISH_ERROR_CODE.REMOTE_VERIFICATION_FAILED,
        `${key} remote metadata differs: bytes ${head.bytes}/${object.bytes}`,
      )
    }
  }

  const remoteManifest = await store.read({ key: manifestKeyOf(manifest) as never })
  if (sha256Of(remoteManifest.body) !== planned.plannedManifest.sha256) {
    throw new PublishError(
      PUBLISH_ERROR_CODE.REMOTE_VERIFICATION_FAILED,
      "remote manifest bytes differ from the plan after upload",
    )
  }

  const pointerKey = pointerKeyOf(manifest.siteId)
  const existingPointerHead = await store.head({ key: pointerKey as never })
  let newEtag: ETag
  let oldEtag: ETag | null = null

  if (existingPointerHead === null) {
    const created = await store.createCurrentPointer({
      pointer: createCurrentPointer({
        actor,
        release: input.verifiedManifest,
        updatedAt: manifest.createdAt,
      }),
    })
    newEtag = created.etag
  } else {
    const current = await pointerBodyOf(store, manifest.siteId)
    oldEtag = existingPointerHead.etag
    if (
      current !== null &&
      current.releaseId === manifest.releaseId &&
      current.manifestSha256 === input.verifiedManifest.manifestSha256
    ) {
      const receipt = PublishReceiptSchema.parse({
        action: "publish",
        actor,
        manifestSha256: input.verifiedManifest.manifestSha256,
        newEtag: existingPointerHead.etag,
        oldEtag,
        recordedAt: manifest.createdAt,
        releaseId: manifest.releaseId,
        schemaVersion: 1,
        siteId: manifest.siteId,
      })
      return { etag: existingPointerHead.etag, pointer: current, receipt }
    }
    const swapped = await store.compareAndSwapCurrentPointer({
      expectedEtag: existingPointerHead.etag,
      pointer: createCurrentPointer({
        actor,
        release: input.verifiedManifest,
        updatedAt: manifest.createdAt,
      }),
    })
    newEtag = swapped.etag
  }

  const finalPointer = await pointerBodyOf(store, manifest.siteId)
  const receipt = PublishReceiptSchema.parse({
    action: "publish",
    actor,
    manifestSha256: input.verifiedManifest.manifestSha256,
    newEtag,
    oldEtag,
    recordedAt: manifest.createdAt,
    releaseId: manifest.releaseId,
    schemaVersion: 1,
    siteId: manifest.siteId,
  })
  if (finalPointer === null) {
    throw new PublishError(PUBLISH_ERROR_CODE.POINTER_UNREADABLE, manifest.siteId)
  }
  return { etag: newEtag, pointer: finalPointer, receipt }
}

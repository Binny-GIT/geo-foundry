import {
  type AuditActor,
  type CurrentPointer,
  createCurrentPointer,
  type ETag,
  type RollbackReceipt,
  RollbackReceiptSchema,
} from "@geo/schema/release/v1"

import type { ArtifactStore } from "./artifact-store.js"
import {
  pointerOf,
  ROLLBACK_ERROR_CODE,
  RollbackError,
  type VerifiedRemoteRelease,
  verifyRemoteRelease,
} from "./rollback-support.js"

export {
  ROLLBACK_ERROR_CODE,
  RollbackError,
  type RollbackErrorCode,
  type VerifiedRemoteRelease,
  verifyRemoteRelease,
} from "./rollback-support.js"

export type RollbackResult = {
  readonly etag: ETag
  readonly pointer: CurrentPointer
  readonly receipt: RollbackReceipt
}

const receiptOf = (input: {
  readonly actor: AuditActor
  readonly fromManifestSha256: string
  readonly fromReleaseId: string
  readonly newEtag: ETag
  readonly oldEtag: ETag
  readonly recordedAt: string
  readonly target: VerifiedRemoteRelease
}): RollbackReceipt =>
  RollbackReceiptSchema.parse({
    action: "rollback",
    actor: input.actor,
    fromManifestSha256: input.fromManifestSha256,
    fromReleaseId: input.fromReleaseId,
    manifestSha256: input.target.verifiedManifest.manifestSha256,
    newEtag: input.newEtag,
    oldEtag: input.oldEtag,
    recordedAt: input.recordedAt,
    releaseId: input.target.verifiedManifest.releaseId,
    schemaVersion: 1,
    siteId: input.target.verifiedManifest.siteId,
  })

/** Verifies a prior immutable release and CAS-switches only its current pointer. */
export const rollbackRelease = async (input: {
  readonly actor: AuditActor
  readonly expectedCurrentManifestSha256: string
  readonly expectedCurrentReleaseId: string
  readonly expectedManifestSha256: string
  readonly recordedAt: string
  readonly releaseId: string
  readonly siteId: string
  readonly store: ArtifactStore
}): Promise<RollbackResult> => {
  const current = await pointerOf(input.store, input.siteId)
  const target = await verifyRemoteRelease(input)
  const targetIsCurrent =
    current.pointer.releaseId === target.verifiedManifest.releaseId &&
    current.pointer.manifestSha256 === target.verifiedManifest.manifestSha256
  const expectedCurrent =
    current.pointer.releaseId === input.expectedCurrentReleaseId &&
    current.pointer.manifestSha256 === input.expectedCurrentManifestSha256
  if (!expectedCurrent && !targetIsCurrent) {
    throw new RollbackError(
      ROLLBACK_ERROR_CODE.EXPECTED_CURRENT_MISMATCH,
      `${current.pointer.releaseId}/${current.pointer.manifestSha256}`,
    )
  }
  if (targetIsCurrent) {
    return {
      etag: current.etag,
      pointer: current.pointer,
      receipt: receiptOf({
        actor: input.actor,
        fromManifestSha256: input.expectedCurrentManifestSha256,
        fromReleaseId: input.expectedCurrentReleaseId,
        newEtag: current.etag,
        oldEtag: current.etag,
        recordedAt: input.recordedAt,
        target,
      }),
    }
  }
  const swapped = await input.store.compareAndSwapCurrentPointer({
    expectedEtag: current.etag,
    pointer: createCurrentPointer({
      actor: input.actor,
      release: target.verifiedManifest,
      updatedAt: input.recordedAt as never,
    }),
  })
  const final = await pointerOf(input.store, input.siteId)
  if (
    final.pointer.releaseId !== target.verifiedManifest.releaseId ||
    final.pointer.manifestSha256 !== target.verifiedManifest.manifestSha256
  ) {
    throw new RollbackError(ROLLBACK_ERROR_CODE.RELEASE_POINTER_MISMATCH, input.siteId)
  }
  return {
    etag: swapped.etag,
    pointer: final.pointer,
    receipt: receiptOf({
      actor: input.actor,
      fromManifestSha256: current.pointer.manifestSha256,
      fromReleaseId: current.pointer.releaseId,
      newEtag: swapped.etag,
      oldEtag: current.etag,
      recordedAt: input.recordedAt,
      target,
    }),
  }
}

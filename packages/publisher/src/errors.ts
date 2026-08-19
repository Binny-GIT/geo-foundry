import type { ETag } from "@geo/schema/release/v1"

export const PUBLISHER_CONTRACT_ERROR_CODE = {
  POINTER_ETAG_STALE: "ARTIFACT_STORE_POINTER_ETAG_STALE",
} as const

export type PublisherContractErrorCode =
  (typeof PUBLISHER_CONTRACT_ERROR_CODE)[keyof typeof PUBLISHER_CONTRACT_ERROR_CODE]

export const RELEASE_BUILD_ERROR_CODE = {
  RELEASE_COMPILER_UNSUPPORTED: "RELEASE_COMPILER_UNSUPPORTED",
  RELEASE_MANIFEST_INVALID: "RELEASE_MANIFEST_INVALID",
  RELEASE_OBJECT_BYTES_MISMATCH: "RELEASE_OBJECT_BYTES_MISMATCH",
  RELEASE_OBJECT_CONTENT_TYPE_MISMATCH: "RELEASE_OBJECT_CONTENT_TYPE_MISMATCH",
  RELEASE_OBJECT_EXTRA: "RELEASE_OBJECT_EXTRA",
  RELEASE_OBJECT_MISSING: "RELEASE_OBJECT_MISSING",
  RELEASE_OBJECT_PATH_DUPLICATE: "RELEASE_OBJECT_PATH_DUPLICATE",
  RELEASE_OBJECT_SHA256_MISMATCH: "RELEASE_OBJECT_SHA256_MISMATCH",
  RELEASE_PATH_UNSAFE: "RELEASE_PATH_UNSAFE",
  RELEASE_SCHEMA_UNSUPPORTED: "RELEASE_SCHEMA_UNSUPPORTED",
  RELEASE_WRITE_FAILED: "RELEASE_WRITE_FAILED",
} as const

export type ReleaseBuildErrorCode =
  (typeof RELEASE_BUILD_ERROR_CODE)[keyof typeof RELEASE_BUILD_ERROR_CODE]

/** Build/verify stage the release never left: "building" or "failed". */
export type ReleaseStageState = "building" | "failed"

export class ReleaseBuildError extends Error {
  override readonly name = "ReleaseBuildError"

  constructor(
    readonly code: ReleaseBuildErrorCode,
    message: string,
    readonly state: ReleaseStageState,
  ) {
    super(`${code}: ${message}`)
  }
}

export class PublisherContractError extends Error {
  override readonly name: string = "PublisherContractError"

  constructor(
    readonly code: PublisherContractErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export class StalePointerEtagError extends PublisherContractError {
  override readonly name: string = "StalePointerEtagError"

  constructor(
    readonly expectedEtag: ETag,
    readonly actualEtag: ETag,
  ) {
    super(
      PUBLISHER_CONTRACT_ERROR_CODE.POINTER_ETAG_STALE,
      "Current pointer ETag does not match the compare-and-swap precondition",
    )
  }
}

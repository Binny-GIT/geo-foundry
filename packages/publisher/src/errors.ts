import type { ETag } from "@geo/schema/release/v1"

export const PUBLISHER_CONTRACT_ERROR_CODE = {
  POINTER_ETAG_STALE: "ARTIFACT_STORE_POINTER_ETAG_STALE",
} as const

export type PublisherContractErrorCode =
  (typeof PUBLISHER_CONTRACT_ERROR_CODE)[keyof typeof PUBLISHER_CONTRACT_ERROR_CODE]

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

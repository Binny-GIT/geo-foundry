export const RELEASE_CONTRACT_ERROR_CODE = {
  ARTIFACT_BYTES_MISMATCH: "ARTIFACT_BYTES_MISMATCH",
  ARTIFACT_CONTENT_TYPE_MISMATCH: "ARTIFACT_CONTENT_TYPE_MISMATCH",
  ARTIFACT_PATH_MISMATCH: "ARTIFACT_PATH_MISMATCH",
  ARTIFACT_SHA256_MISMATCH: "ARTIFACT_SHA256_MISMATCH",
  RELEASE_CONTRACT_UNREACHABLE: "RELEASE_CONTRACT_UNREACHABLE",
  RELEASE_POINTER_UNVERIFIED: "RELEASE_POINTER_UNVERIFIED",
} as const

export type ReleaseContractErrorCode =
  (typeof RELEASE_CONTRACT_ERROR_CODE)[keyof typeof RELEASE_CONTRACT_ERROR_CODE]

export class ReleaseContractError extends Error {
  override readonly name: string = "ReleaseContractError"

  constructor(
    readonly code: ReleaseContractErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type ArtifactIntegrityField = "bytes" | "contentType" | "path" | "sha256"

export class ArtifactIntegrityError extends ReleaseContractError {
  override readonly name: string = "ArtifactIntegrityError"

  constructor(
    code: ReleaseContractErrorCode,
    readonly field: ArtifactIntegrityField,
    readonly expected: number | string,
    readonly actual: number | string,
  ) {
    super(code, `Artifact ${field} does not match the immutable manifest`)
  }
}

export class UnverifiedReleasePointerError extends ReleaseContractError {
  override readonly name: string = "UnverifiedReleasePointerError"

  constructor(readonly releaseId: string) {
    super(
      RELEASE_CONTRACT_ERROR_CODE.RELEASE_POINTER_UNVERIFIED,
      "Current pointer requires a verified release",
    )
  }
}

export class ReleaseContractInvariantError extends ReleaseContractError {
  override readonly name: string = "ReleaseContractInvariantError"

  constructor() {
    super(
      RELEASE_CONTRACT_ERROR_CODE.RELEASE_CONTRACT_UNREACHABLE,
      "Release contract reached an unreachable state",
    )
  }
}

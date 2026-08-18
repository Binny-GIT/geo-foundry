import { z } from "zod"

import {
  ArtifactIntegrityError,
  RELEASE_CONTRACT_ERROR_CODE,
  type ArtifactIntegrityField,
  type ReleaseContractErrorCode,
} from "./errors.js"
import { ContentTypeSchema, ReleaseArtifactPathSchema, Sha256Schema } from "./primitives.js"

export const ImmutableArtifactSchema = z
  .strictObject({
    bytes: z.number().int().nonnegative(),
    contentType: ContentTypeSchema,
    path: ReleaseArtifactPathSchema,
    sha256: Sha256Schema,
  })
  .readonly()

export const ArtifactObservationSchema = ImmutableArtifactSchema

export type ImmutableArtifact = z.infer<typeof ImmutableArtifactSchema>
export type ArtifactObservation = z.infer<typeof ArtifactObservationSchema>

function throwIntegrityError(
  code: ReleaseContractErrorCode,
  field: ArtifactIntegrityField,
  expected: number | string,
  actual: number | string,
): never {
  throw new ArtifactIntegrityError(code, field, expected, actual)
}

export function verifyArtifactObservation(
  expected: ImmutableArtifact,
  observedInput: unknown,
): ArtifactObservation {
  const observed = ArtifactObservationSchema.parse(observedInput)
  if (observed.path !== expected.path) {
    return throwIntegrityError(
      RELEASE_CONTRACT_ERROR_CODE.ARTIFACT_PATH_MISMATCH,
      "path",
      expected.path,
      observed.path,
    )
  }
  if (observed.bytes !== expected.bytes) {
    return throwIntegrityError(
      RELEASE_CONTRACT_ERROR_CODE.ARTIFACT_BYTES_MISMATCH,
      "bytes",
      expected.bytes,
      observed.bytes,
    )
  }
  if (observed.sha256 !== expected.sha256) {
    return throwIntegrityError(
      RELEASE_CONTRACT_ERROR_CODE.ARTIFACT_SHA256_MISMATCH,
      "sha256",
      expected.sha256,
      observed.sha256,
    )
  }
  if (observed.contentType !== expected.contentType) {
    return throwIntegrityError(
      RELEASE_CONTRACT_ERROR_CODE.ARTIFACT_CONTENT_TYPE_MISMATCH,
      "contentType",
      expected.contentType,
      observed.contentType,
    )
  }
  return observed
}

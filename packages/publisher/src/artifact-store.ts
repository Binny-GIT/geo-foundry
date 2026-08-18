import {
  ARTIFACT_CREATE_CONDITION,
  type ArtifactStoreKey,
  type ContentType,
  ContentTypeSchema,
  type CurrentPointer,
  type CurrentPointerKey,
  currentPointerKey,
  type ETag,
  hashCurrentPointer,
  type ReleaseObjectKey,
  type ReleasePrefix,
  type Sha256,
  serializeCurrentPointer,
} from "@geo/schema/release/v1"

import { StalePointerEtagError } from "./errors.js"

const CURRENT_POINTER_CONTENT_TYPE = ContentTypeSchema.parse("application/json")

export type ArtifactObjectHead = {
  readonly bytes: number
  readonly contentType: ContentType
  readonly etag: ETag
  readonly key: ArtifactStoreKey
  readonly sha256: Sha256
}

export type ArtifactObject = ArtifactObjectHead & {
  readonly body: Uint8Array
}

export type CreateIfAbsentRequest = {
  readonly body: Uint8Array
  readonly condition: typeof ARTIFACT_CREATE_CONDITION
  readonly contentType: ContentType
  readonly key: ReleaseObjectKey
  readonly sha256: Sha256
}

export type CreateCurrentPointerRequest = {
  readonly pointer: CurrentPointer
}

export type ReadArtifactRequest = {
  readonly key: ArtifactStoreKey
}

export type ListArtifactsRequest = {
  readonly prefix: ReleasePrefix
}

export type HeadArtifactRequest = {
  readonly key: ArtifactStoreKey
}

export type CompareAndSwapCurrentPointerRequest = {
  readonly expectedEtag: ETag
  readonly pointer: CurrentPointer
}

export interface ArtifactStore {
  createIfAbsent(request: CreateIfAbsentRequest): Promise<ArtifactObjectHead>
  createCurrentPointer(request: CreateCurrentPointerRequest): Promise<ArtifactObjectHead>
  read(request: ReadArtifactRequest): Promise<ArtifactObject>
  list(request: ListArtifactsRequest): Promise<readonly ArtifactObjectHead[]>
  head(request: HeadArtifactRequest): Promise<ArtifactObjectHead | null>
  compareAndSwapCurrentPointer(
    request: CompareAndSwapCurrentPointerRequest,
  ): Promise<ArtifactObjectHead>
}

export type CurrentPointerObjectWrite = {
  readonly body: Uint8Array
  readonly bytes: number
  readonly contentType: ContentType
  readonly key: CurrentPointerKey
  readonly sha256: Sha256
}

export type InitialCurrentPointerWrite = CurrentPointerObjectWrite & {
  readonly condition: typeof ARTIFACT_CREATE_CONDITION
}

export type CompareAndSwapCurrentPointerWrite = CurrentPointerObjectWrite & {
  readonly condition: "if-match"
  readonly expectedEtag: ETag
}

async function prepareCurrentPointerObject(
  pointer: CurrentPointer,
): Promise<CurrentPointerObjectWrite> {
  const body = serializeCurrentPointer(pointer)
  return Object.freeze({
    body,
    bytes: body.byteLength,
    contentType: CURRENT_POINTER_CONTENT_TYPE,
    key: currentPointerKey(pointer.siteId),
    sha256: await hashCurrentPointer(pointer),
  })
}

export async function prepareCurrentPointerInitialCreate(
  request: CreateCurrentPointerRequest,
): Promise<InitialCurrentPointerWrite> {
  return Object.freeze({
    ...(await prepareCurrentPointerObject(request.pointer)),
    condition: ARTIFACT_CREATE_CONDITION,
  })
}

export async function prepareCurrentPointerCompareAndSwap(
  request: CompareAndSwapCurrentPointerRequest,
): Promise<CompareAndSwapCurrentPointerWrite> {
  return Object.freeze({
    ...(await prepareCurrentPointerObject(request.pointer)),
    condition: "if-match",
    expectedEtag: request.expectedEtag,
  })
}

export type PointerEtagComparison = {
  readonly actualEtag: ETag
  readonly expectedEtag: ETag
}

export function assertPointerEtagMatches(comparison: PointerEtagComparison): ETag {
  if (comparison.actualEtag !== comparison.expectedEtag) {
    throw new StalePointerEtagError(comparison.expectedEtag, comparison.actualEtag)
  }
  return comparison.actualEtag
}

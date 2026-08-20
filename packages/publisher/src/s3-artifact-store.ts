import {
  type ClientDefaults,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import {
  type ArtifactStoreKey,
  type ContentType,
  ContentTypeSchema,
  type CurrentPointer,
  currentPointerKey,
  type ETag,
  ETagSchema,
  type ReleasePrefix,
  Sha256Schema,
} from "@geo/schema/release/v1"
import {
  type ArtifactObject,
  type ArtifactObjectHead,
  type ArtifactStore,
  type CompareAndSwapCurrentPointerRequest,
  type CreateCurrentPointerRequest,
  type CreateIfAbsentRequest,
  type HeadArtifactRequest,
  type ListArtifactsRequest,
  prepareCurrentPointerCompareAndSwap,
  prepareCurrentPointerInitialCreate,
  type ReadArtifactRequest,
} from "./artifact-store.js"
import { StalePointerEtagError } from "./errors.js"

const releaseKeyOfRaw = (key: ArtifactStoreKey): string => key
const prefixOfRaw = (prefix: ReleasePrefix): string => prefix

export const S3_ARTIFACT_STORE_ERROR_CODE = {
  OBJECT_ALREADY_EXISTS: "S3_ARTIFACT_STORE_OBJECT_ALREADY_EXISTS",
  POINTER_ALREADY_EXISTS: "S3_ARTIFACT_STORE_POINTER_ALREADY_EXISTS",
  POINTER_CONDITION_FAILED: "S3_ARTIFACT_STORE_POINTER_CONDITION_FAILED",
  READ_FAILED: "S3_ARTIFACT_STORE_READ_FAILED",
} as const

export type S3ArtifactStoreErrorCode =
  (typeof S3_ARTIFACT_STORE_ERROR_CODE)[keyof typeof S3_ARTIFACT_STORE_ERROR_CODE]

export class S3ArtifactStoreError extends Error {
  override readonly name = "S3ArtifactStoreError"

  constructor(
    readonly code: S3ArtifactStoreErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

export type S3ArtifactStoreOptions = {
  readonly bucket: string
  readonly client?: S3Client
  readonly clientConfig: S3ClientConfig & ClientDefaults
  /**
   * Physical key prefix inside the bucket for shared RustFS deployments
   * whose IAM scopes a project to one prefix (e.g. "objects"). Logical
   * release/pointer keys stay schema-shaped; only the wire key is mapped.
   */
  readonly keyPrefix?: string
}

const etagOf = (value: string | undefined): ETag =>
  parseEtag(value === undefined ? '"-"' : `"${value.replace(/"/g, "")}"`)

const parseEtag = (value: string): ETag => ETagSchema.parse(value)

const contentTypeOf = (value: string | undefined): ContentType =>
  ContentTypeSchema.parse(value ?? "application/octet-stream")

const zeroSha = (): string => "0".repeat(64)

const headOf = (
  key: ArtifactStoreKey,
  output: {
    readonly ContentType?: string | undefined
    readonly ContentLength?: number | undefined
    readonly ETag?: string | undefined
  },
): ArtifactObjectHead => ({
  bytes: output.ContentLength ?? 0,
  contentType: contentTypeOf(output.ContentType),
  etag: etagOf(output.ETag),
  key,
  sha256: Sha256Schema.parse(zeroSha()),
})

/**
 * RustFS/S3-backed ArtifactStore. Every write is conditional: release objects
 * use If-None-Match:* (immutable creates only), the site pointer uses
 * create-if-absent or If-Match compare-and-swap. No delete or overwrite
 * operation exists on this surface.
 */
export const createS3ArtifactStore = (options: S3ArtifactStoreOptions): ArtifactStore => {
  const client = options.client ?? new S3Client(options.clientConfig)
  const bucket = options.bucket
  const keyPrefix = options.keyPrefix === undefined ? "" : options.keyPrefix.replace(/\/$/, "")
  const physicalKey = (key: string): string => (keyPrefix === "" ? key : `${keyPrefix}/${key}`)
  const logicalKey = (key: string): string =>
    keyPrefix === "" ? key : key.startsWith(`${keyPrefix}/`) ? key.slice(keyPrefix.length + 1) : key
  const store: ArtifactStore = {
    async createIfAbsent(request: CreateIfAbsentRequest): Promise<ArtifactObjectHead> {
      const put = await client.send(
        new PutObjectCommand({
          Body: request.body,
          Bucket: bucket,
          ContentType: request.contentType,
          IfNoneMatch: "*",
          Key: physicalKey(releaseKeyOfRaw(request.key)),
        }),
      )
      return {
        bytes: request.body.byteLength,
        contentType: request.contentType,
        etag: etagOf(put.ETag),
        key: request.key,
        sha256: request.sha256,
      }
    },
    async createCurrentPointer(request: CreateCurrentPointerRequest): Promise<ArtifactObjectHead> {
      const write = await prepareCurrentPointerInitialCreate(request)
      const put = await client.send(
        new PutObjectCommand({
          Body: write.body,
          Bucket: bucket,
          ContentType: write.contentType,
          IfNoneMatch: "*",
          Key: physicalKey(write.key),
        }),
      )
      return {
        bytes: write.bytes,
        contentType: write.contentType,
        etag: etagOf(put.ETag),
        key: write.key,
        sha256: write.sha256,
      }
    },
    async read(request: ReadArtifactRequest): Promise<ArtifactObject> {
      const output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: physicalKey(releaseKeyOfRaw(request.key)) }),
      )
      const body = await output.Body?.transformToByteArray()
      if (body === undefined) {
        throw new S3ArtifactStoreError(S3_ARTIFACT_STORE_ERROR_CODE.READ_FAILED, request.key)
      }
      return {
        body: new Uint8Array(body),
        bytes: body.byteLength,
        contentType: contentTypeOf(output.ContentType),
        etag: etagOf(output.ETag),
        key: request.key,
        sha256: Sha256Schema.parse(zeroSha()),
      }
    },
    async list(request: ListArtifactsRequest): Promise<readonly ArtifactObjectHead[]> {
      const entries: ArtifactObjectHead[] = []
      let token: string | undefined
      do {
        const output = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: token,
            Prefix: physicalKey(prefixOfRaw(request.prefix)),
          }),
        )
        for (const object of output.Contents ?? []) {
          if (object.Key === undefined) {
            continue
          }
          entries.push(headOf(logicalKey(object.Key) as ArtifactStoreKey, object))
        }
        token = output.IsTruncated ? output.NextContinuationToken : undefined
      } while (token !== undefined)
      return entries
    },
    async head(request: HeadArtifactRequest): Promise<ArtifactObjectHead | null> {
      try {
        const output = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: physicalKey(releaseKeyOfRaw(request.key)) }),
        )
        return headOf(request.key, output)
      } catch (error) {
        if (error instanceof Error && error.name === "NotFound") {
          return null
        }
        throw error
      }
    },
    async compareAndSwapCurrentPointer(
      request: CompareAndSwapCurrentPointerRequest,
    ): Promise<ArtifactObjectHead> {
      const write = await prepareCurrentPointerCompareAndSwap(request)
      try {
        const put = await client.send(
          new PutObjectCommand({
            Body: write.body,
            Bucket: bucket,
            ContentType: write.contentType,
            IfMatch: request.expectedEtag,
            Key: physicalKey(write.key),
          }),
        )
        return {
          bytes: write.bytes,
          contentType: write.contentType,
          etag: etagOf(put.ETag),
          key: write.key,
          sha256: write.sha256,
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "PreconditionFailed" ||
            error.name === "ConditionalRequestConflict" ||
            error.name === "412")
        ) {
          throw new StalePointerEtagError(request.expectedEtag, request.expectedEtag)
        }
        throw error
      }
    },
  }
  return store
}

export const routingManifestObjectKey = (routingId: string): string =>
  `routing/releases/${routingId}/domains.json`

export const routingPointerKey = "routing/channels/current.json"

export const currentPointerObjectKeyOf = (pointer: CurrentPointer): string =>
  currentPointerKey(pointer.siteId)

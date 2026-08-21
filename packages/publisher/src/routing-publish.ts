import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import {
  hashRoutingManifest,
  RoutingIdSchema,
  RoutingManifestPointerSchema,
  serializeRoutingManifest,
  type ETag,
  type RoutingManifestInput,
  type RoutingManifestPointer,
} from "@geo/schema/release/v1"

import { S3ArtifactStoreError, type S3ArtifactStoreOptions } from "./s3-artifact-store.js"

export const ROUTING_PUBLISH_ERROR_CODE = {
  ROUTING_MANIFEST_EXISTS_WITH_DIFFERENT_CONTENT: "ROUTING_MANIFEST_EXISTS_WITH_DIFFERENT_CONTENT",
  ROUTING_POINTER_CONDITION_FAILED: "ROUTING_POINTER_CONDITION_FAILED",
  ROUTING_POINTER_UNREADABLE: "ROUTING_POINTER_UNREADABLE",
  ROUTING_SITE_RELEASE_MISSING: "ROUTING_SITE_RELEASE_MISSING",
  ROUTING_SITE_POINTER_MISSING: "ROUTING_SITE_POINTER_MISSING",
} as const

export type RoutingPublishErrorCode =
  (typeof ROUTING_PUBLISH_ERROR_CODE)[keyof typeof ROUTING_PUBLISH_ERROR_CODE]

export class RoutingPublishError extends Error {
  override readonly name = "RoutingPublishError"

  constructor(
    readonly code: RoutingPublishErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

const isPreconditionFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "PreconditionFailed" ||
    error.name === "ConditionalRequestConflict" ||
    error.name === "412")

/**
 * Raw conditional-write surface for the global routing namespace. The site
 * ArtifactStore contract stays untouched; routing objects live under their
 * own keys (routing/releases/<id>/domains.json plus the
 * routing/channels/current.json pointer) and follow the same
 * create-if-absent / If-Match rules.
 */
export type S3RoutingStore = {
  readonly putManifestIfAbsent: (input: {
    readonly body: Uint8Array
    readonly contentType: string
    readonly routingId: string
    readonly sha256: string
  }) => Promise<ETag>
  readonly headPointer: () => Promise<ETag | null>
  readonly readPointer: () => Promise<Uint8Array>
  readonly compareAndSwapPointer: (input: {
    readonly body: Uint8Array
    readonly expectedEtag: ETag
  }) => Promise<ETag>
  readonly createPointerIfAbsent: (input: { readonly body: Uint8Array }) => Promise<ETag>
  readonly headSiteReleaseManifest: (siteReleaseObjectKey: string) => Promise<boolean>
  readonly headSitePointer: (sitePointerObjectKey: string) => Promise<boolean>
}

export const createS3RoutingStore = (options: S3ArtifactStoreOptions): S3RoutingStore => {
  const client = options.client ?? new S3Client(options.clientConfig)
  const bucket = options.bucket
  const keyPrefix = options.keyPrefix === undefined ? "" : options.keyPrefix.replace(/\/$/, "")
  const physical = (key: string): string => (keyPrefix === "" ? key : `${keyPrefix}/${key}`)
  const etagOf = (value: string | undefined): ETag =>
    (value === undefined ? '"-"' : `"${value.replace(/"/g, "")}"`) as ETag

  return {
    async putManifestIfAbsent(input) {
      const key = physical(`routing/releases/${input.routingId}/domains.json`)
      try {
        const put = await client.send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: bucket,
            ContentType: input.contentType,
            IfNoneMatch: "*",
            Key: key,
          }),
        )
        return etagOf(put.ETag)
      } catch (error) {
        if (!isPreconditionFailure(error)) {
          throw error
        }
        const existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        const body = await existing.Body?.transformToByteArray()
        if (
          body === undefined ||
          new TextDecoder().decode(body) !== new TextDecoder().decode(input.body)
        ) {
          throw new RoutingPublishError(
            ROUTING_PUBLISH_ERROR_CODE.ROUTING_MANIFEST_EXISTS_WITH_DIFFERENT_CONTENT,
            `routing manifest ${input.routingId} exists with different content`,
          )
        }
        return etagOf(existing.ETag)
      }
    },
    async headPointer() {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: physical("routing/channels/current.json") }),
        )
        return etagOf(head.ETag)
      } catch (error) {
        if (error instanceof Error && error.name === "NotFound") {
          return null
        }
        throw error
      }
    },
    async readPointer() {
      const object = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: physical("routing/channels/current.json") }),
      )
      const body = await object.Body?.transformToByteArray()
      if (body === undefined) {
        throw new S3ArtifactStoreError(
          "S3_ARTIFACT_STORE_READ_FAILED" as never,
          "routing/channels/current.json",
        )
      }
      return new Uint8Array(body)
    },
    async compareAndSwapPointer(input) {
      try {
        const put = await client.send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: bucket,
            ContentType: "application/json",
            IfMatch: input.expectedEtag,
            Key: physical("routing/channels/current.json"),
          }),
        )
        return etagOf(put.ETag)
      } catch (error) {
        if (isPreconditionFailure(error)) {
          throw new RoutingPublishError(
            ROUTING_PUBLISH_ERROR_CODE.ROUTING_POINTER_CONDITION_FAILED,
            "routing pointer CAS precondition failed",
          )
        }
        throw error
      }
    },
    async createPointerIfAbsent(input) {
      try {
        const put = await client.send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: bucket,
            ContentType: "application/json",
            IfNoneMatch: "*",
            Key: physical("routing/channels/current.json"),
          }),
        )
        return etagOf(put.ETag)
      } catch (error) {
        if (isPreconditionFailure(error)) {
          throw new RoutingPublishError(
            ROUTING_PUBLISH_ERROR_CODE.ROUTING_POINTER_CONDITION_FAILED,
            "routing pointer create race lost",
          )
        }
        throw error
      }
    },
    async headSiteReleaseManifest(siteReleaseObjectKey) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: physical(siteReleaseObjectKey) }),
        )
        return true
      } catch (error) {
        if (error instanceof Error && error.name === "NotFound") {
          return false
        }
        throw error
      }
    },
    async headSitePointer(sitePointerObjectKey) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: physical(sitePointerObjectKey) }),
        )
        return true
      } catch (error) {
        if (error instanceof Error && error.name === "NotFound") {
          return false
        }
        throw error
      }
    },
  }
}

export type RoutingManifestPointerDocument = RoutingManifestPointer

/**
 * Publish the global routing manifest: manifest object first (conditional),
 * then verify every referenced site pointer AND site release manifest exist,
 * and only then CAS the routing pointer. A lost CAS race or a missing
 * reference leaves the previous pointer serving a complete routing state.
 */
export const publishRoutingManifest = async (input: {
  readonly manifest: RoutingManifestInput
  readonly routingId: string
  readonly routingStore: S3RoutingStore
  readonly siteReleaseObjectKeys: readonly string[]
  readonly sitePointerObjectKeys: readonly string[]
  readonly updatedAt: string
}): Promise<RoutingManifestPointerDocument> => {
  const routingId = RoutingIdSchema.parse(input.routingId)
  const body = serializeRoutingManifest(input.manifest)
  const sha256 = await hashRoutingManifest(input.manifest)
  await input.routingStore.putManifestIfAbsent({
    body,
    contentType: "application/json",
    routingId,
    sha256,
  })

  for (const key of input.sitePointerObjectKeys) {
    if (!(await input.routingStore.headSitePointer(key))) {
      throw new RoutingPublishError(
        ROUTING_PUBLISH_ERROR_CODE.ROUTING_SITE_POINTER_MISSING,
        `site pointer ${key} does not exist; routing cannot reference it`,
      )
    }
  }
  for (const key of input.siteReleaseObjectKeys) {
    if (!(await input.routingStore.headSiteReleaseManifest(key))) {
      throw new RoutingPublishError(
        ROUTING_PUBLISH_ERROR_CODE.ROUTING_SITE_RELEASE_MISSING,
        `site release ${key} does not exist; routing cannot reference it`,
      )
    }
  }

  const pointer: RoutingManifestPointerDocument = RoutingManifestPointerSchema.parse({
    manifestSha256: sha256,
    routingId,
    updatedAt: input.updatedAt,
  })
  const pointerBody = new TextEncoder().encode(JSON.stringify(pointer))
  const existingEtag = await input.routingStore.headPointer()
  if (existingEtag === null) {
    await input.routingStore.createPointerIfAbsent({ body: pointerBody })
    return pointer
  }
  const currentBody = input.routingStore.readPointer()
  const currentText = new TextDecoder().decode(await currentBody)
  if (currentText === JSON.stringify(pointer)) {
    return pointer
  }
  await input.routingStore.compareAndSwapPointer({
    body: pointerBody,
    expectedEtag: existingEtag,
  })
  return pointer
}

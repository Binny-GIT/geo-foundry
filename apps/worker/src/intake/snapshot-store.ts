import { createHash } from "node:crypto"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

import type { WorkerS3Options } from "../processors/release-pipeline.js"

export type StoredSnapshot = Readonly<{
  contentHash: string
  contentLength: number
  contentType: string
  storageKey: string
}>

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

export const snapshotStorageKeyOf = (
  options: WorkerS3Options,
  tenantId: number,
  intakeItemId: number,
  kind: "extracted-content" | "raw-response",
  hash: string,
): string => {
  const prefix = options.keyPrefix.replace(/\/+$/, "")
  return `${prefix}/source-snapshots/${tenantId}/${intakeItemId}/${kind}-${hash}.${kind === "raw-response" ? "bin" : "txt"}`
}

const alreadyExists = (error: unknown): boolean => {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412
}

/** Immutable source-snapshot writer: deterministic keys and If-None-Match only. */
export const createSnapshotStore = (options: WorkerS3Options) => {
  const client = new S3Client({
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    endpoint: `${options.useSSL ? "https" : "http"}://${options.endpointHost}:${options.endpointPort}`,
    forcePathStyle: true,
    region: "us-east-1",
  })
  return {
    close: () => client.destroy(),
    put: async (
      input: {
        readonly body: Uint8Array
        readonly contentType: string
        readonly intakeItemId: number
        readonly kind: "extracted-content" | "raw-response"
        readonly tenantId: number
      },
    ): Promise<StoredSnapshot> => {
      const contentHash = sha256(input.body)
      const storageKey = snapshotStorageKeyOf(
        options,
        input.tenantId,
        input.intakeItemId,
        input.kind,
        contentHash,
      )
      try {
        await client.send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: options.bucket,
            ContentType: input.contentType,
            IfNoneMatch: "*",
            Key: storageKey,
          }),
        )
      } catch (error) {
        if (!alreadyExists(error)) throw error
      }
      return {
        contentHash,
        contentLength: input.body.byteLength,
        contentType: input.contentType,
        storageKey,
      }
    },
  }
}

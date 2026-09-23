/*
 * 只读对象存储读取器：移植自 examples/site-b-express/server/s3-reader.mjs，
 * 从 JS 端口到 TS，实现 @geo/runtime 的 RuntimeObjectReader 接口
 * （head/read 两个方法）。除了语言迁移，行为与示例保持一致——独立的
 * S3Client 实例，只用 GetObjectCommand/HeadObjectCommand，没有任何写入
 * 方法，满足"交付侧保持只读"的约束。
 *
 * 这一个 store 同时服务两处调用方：
 *   1. @geo/runtime 的 createRuntime({ store })（页面/sitemap 解析）
 *   2. 本包 src/runtime/media.ts 的 resolveMedia（媒体对象读取）
 * 二者读取的都是同一个 release 对象键空间（sites/<siteId>/releases/<releaseId>/...），
 * 媒体在产物里就是 media/<filename> 这一条普通 artifact，不需要第二个
 * S3 客户端或单独的 bucket/前缀。
 */
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"

import type { RuntimeObject, RuntimeObjectHead, RuntimeObjectReader } from "@geo/runtime"

import type { DeliveryS3Options } from "../config/environment.js"

const physicalKeyOf = (prefix: string, key: string): string => `${prefix}/${key}`

const etagOf = (value: string | undefined): string =>
  value === undefined ? '"-"' : `"${value.replaceAll('"', "")}"`

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("name" in error && (error.name === "NotFound" || error.name === "NoSuchKey")) ||
    ("$metadata" in error &&
      typeof (error as { readonly $metadata: unknown }).$metadata === "object" &&
      (error as { readonly $metadata: unknown }).$metadata !== null &&
      "httpStatusCode" in (error as { readonly $metadata: Record<string, unknown> }).$metadata &&
      (error as { readonly $metadata: Record<string, unknown> }).$metadata["httpStatusCode"] === 404))

export type DeliveryObjectReader = RuntimeObjectReader & {
  /** 关闭底层 S3 连接池；进程退出前调用一次。 */
  destroy(): void
}

export const createDeliveryObjectReader = (options: DeliveryS3Options): DeliveryObjectReader => {
  const client = new S3Client({
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    endpoint: `${options.useSSL ? "https" : "http"}://${options.endpointHost}:${options.endpointPort}`,
    forcePathStyle: true,
    region: "us-east-1",
  })
  return Object.freeze({
    destroy(): void {
      client.destroy()
    },
    async head(key: string): Promise<RuntimeObjectHead | null> {
      try {
        const output = await client.send(
          new HeadObjectCommand({
            Bucket: options.bucket,
            Key: physicalKeyOf(options.keyPrefix, key),
          }),
          { abortSignal: AbortSignal.timeout(options.timeoutMs) },
        )
        return {
          bytes: output.ContentLength ?? 0,
          contentType: output.ContentType ?? "application/octet-stream",
          etag: etagOf(output.ETag),
        }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async read(key: string): Promise<RuntimeObject | null> {
      try {
        const output = await client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: physicalKeyOf(options.keyPrefix, key),
          }),
          { abortSignal: AbortSignal.timeout(options.timeoutMs) },
        )
        const body = await output.Body?.transformToByteArray()
        if (body === undefined) {
          throw new Error("DELIVERY_S3_BODY_MISSING")
        }
        return {
          body: new Uint8Array(body),
          bytes: body.byteLength,
          contentType: output.ContentType ?? "application/octet-stream",
          etag: etagOf(output.ETag),
        }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
  })
}

/* Runtime-only database/config singleton. Import is build-safe: credentials are read lazily on first call. */

import { S3Client } from "@aws-sdk/client-s3"
import { Pool } from "pg"

import { parseCmsEnvironment } from "../config/environment"
import { createServerDb, type ServerDb } from "./db/client"

export type MediaStorage = Readonly<{
  bucket: string
  client: S3Client
  /** 对象键前缀（租户分区之前的固定段），如 objects/media。 */
  mediaPrefix: string
}>

export type ServerRuntime = Readonly<{
  configSecret: string
  db: ServerDb
  media: MediaStorage
  /** 底层 pg 池：pg-boss 适配器与迁移期工具直接复用同一连接来源。 */
  pool: Pool
}>

let runtime: ServerRuntime | null = null

export const serverRuntime = (): ServerRuntime => {
  runtime ??= (() => {
    const environment = parseCmsEnvironment(process.env)
    const pool = new Pool({ connectionString: environment.postgres.connectionString, max: 8 })
    return {
      configSecret: environment.payloadSecret,
      db: createServerDb(pool),
      pool,
      media: {
        bucket: environment.rustfs.bucket,
        client: new S3Client({
          credentials: {
            accessKeyId: environment.rustfs.accessKeyId,
            secretAccessKey: environment.rustfs.secretAccessKey,
          },
          endpoint: environment.rustfs.endpoint,
          forcePathStyle: environment.rustfs.forcePathStyle,
          region: environment.rustfs.region,
        }),
        mediaPrefix: environment.rustfs.mediaPrefix,
      },
    }
  })()
  return runtime
}

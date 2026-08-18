import { ListObjectsV2Command, S3Client, S3ServiceException } from "@aws-sdk/client-s3"
import pg from "pg"
import { z } from "zod"

import type { CmsEnvironment } from "../config/environment"
import { DEPENDENCY_CODES, DependencyProbeError, type DependencyProbe } from "./types"

const postgresErrorSchema = z.object({
  code: z.string(),
})

const postgresStateSchema = z.object({
  database: z.literal("geo_foundry"),
  schema: z.literal("geo_foundry"),
})

export const createPostgresProbe =
  (environment: CmsEnvironment): DependencyProbe =>
  async () => {
    const client = new pg.Client({
      connectionString: environment.postgres.connectionString,
      connectionTimeoutMillis: 5_000,
    })

    try {
      await client.connect()
      const result = await client.query(
        "SELECT current_database() AS database, current_schema() AS schema",
      )
      const state = postgresStateSchema.safeParse(result.rows[0])
      if (!state.success) {
        throw new DependencyProbeError("postgres", DEPENDENCY_CODES.POSTGRES_STATE_INVALID)
      }
    } catch (error) {
      if (error instanceof DependencyProbeError) {
        throw error
      }
      const parsed = postgresErrorSchema.safeParse(error)
      const code =
        parsed.success && parsed.data.code === "28P01"
          ? DEPENDENCY_CODES.POSTGRES_ACCESS_DENIED
          : DEPENDENCY_CODES.POSTGRES_UNAVAILABLE
      throw new DependencyProbeError("postgres", code, { cause: error })
    } finally {
      await client.end()
    }
  }

export const createRustfsProbe =
  (environment: CmsEnvironment): DependencyProbe =>
  async () => {
    const client = new S3Client({
      credentials: {
        accessKeyId: environment.rustfs.accessKeyId,
        secretAccessKey: environment.rustfs.secretAccessKey,
      },
      endpoint: environment.rustfs.endpoint,
      forcePathStyle: environment.rustfs.forcePathStyle,
      region: environment.rustfs.region,
    })

    try {
      await client.send(
        new ListObjectsV2Command({
          Bucket: environment.rustfs.bucket,
          MaxKeys: 1,
          Prefix: "objects/",
        }),
        { abortSignal: AbortSignal.timeout(5_000) },
      )
    } catch (error) {
      const code =
        error instanceof S3ServiceException && error.$metadata.httpStatusCode === 403
          ? DEPENDENCY_CODES.RUSTFS_ACCESS_DENIED
          : DEPENDENCY_CODES.RUSTFS_UNAVAILABLE
      throw new DependencyProbeError("rustfs", code, { cause: error })
    } finally {
      client.destroy()
    }
  }

import { z } from "zod"

import {
  parseCmsSharedServicesEnvironment,
  SharedServicesEnvironmentError,
  type CmsSharedServicesEnvironment,
} from "../../../../config/shared-services.schema"
import { assertNever } from "../shared/assert-never"

export const CMS_BUCKET = "geo-foundry"
export const CMS_MEDIA_PREFIX = "objects/cms-bootstrap/media"
export const CMS_POSTGRES_SCHEMA = "geo_foundry"
export const RUSTFS_REGION = "us-east-1"

const configModeSchema = z.union([z.literal("runtime"), z.literal("build")])
const payloadSecretSchema = z.string().min(32)

export type CmsEnvironment = {
  readonly mode: "runtime" | "build"
  readonly payloadSecret: string
  readonly postgres: {
    readonly connectionString: string
    readonly schema: typeof CMS_POSTGRES_SCHEMA
  }
  readonly rustfs: {
    readonly accessKeyId: string
    readonly bucket: typeof CMS_BUCKET
    readonly endpoint: string
    readonly forcePathStyle: true
    readonly mediaPrefix: typeof CMS_MEDIA_PREFIX
    readonly region: typeof RUSTFS_REGION
    readonly secretAccessKey: string
  }
}

export class CmsEnvironmentError extends Error {
  override readonly name = "CmsEnvironmentError"

  constructor(readonly variables: readonly string[]) {
    super("CMS_ENV_INVALID")
  }
}

const postgresConnectionString = (environment: CmsSharedServicesEnvironment): string => {
  const connection = new URL("postgresql://localhost")
  connection.hostname = environment.GEO_FOUNDRY_PG_HOST
  connection.port = String(environment.GEO_FOUNDRY_PG_PORT)
  connection.username = environment.GEO_FOUNDRY_PG_USER
  connection.password = environment.GEO_FOUNDRY_PG_PASSWORD
  connection.pathname = `/${environment.GEO_FOUNDRY_PG_DATABASE}`
  connection.searchParams.set("application_name", "geo-foundry-cms")
  connection.searchParams.set("options", `-c search_path=${environment.GEO_FOUNDRY_PG_SCHEMA}`)
  return connection.toString()
}

const runtimeEnvironment = (environment: Record<string, string | undefined>): CmsEnvironment => {
  let sharedServices: CmsSharedServicesEnvironment
  try {
    sharedServices = parseCmsSharedServicesEnvironment(environment)
  } catch (error) {
    if (error instanceof SharedServicesEnvironmentError) {
      throw new CmsEnvironmentError(error.variables)
    }
    throw error
  }

  const payloadSecret = payloadSecretSchema.safeParse(environment["PAYLOAD_SECRET"])
  if (!payloadSecret.success) {
    throw new CmsEnvironmentError(["PAYLOAD_SECRET"])
  }

  return {
    mode: "runtime",
    payloadSecret: payloadSecret.data,
    postgres: {
      connectionString: postgresConnectionString(sharedServices),
      schema: CMS_POSTGRES_SCHEMA,
    },
    rustfs: {
      accessKeyId: sharedServices.GEO_FOUNDRY_S3_ACCESS_KEY,
      bucket: CMS_BUCKET,
      endpoint: `${sharedServices.GEO_FOUNDRY_S3_USE_SSL ? "https" : "http"}://${sharedServices.GEO_FOUNDRY_S3_ENDPOINT}:${sharedServices.GEO_FOUNDRY_S3_PORT}`,
      forcePathStyle: true,
      mediaPrefix: CMS_MEDIA_PREFIX,
      region: RUSTFS_REGION,
      secretAccessKey: sharedServices.GEO_FOUNDRY_S3_SECRET_KEY,
    },
  }
}

const buildEnvironment = (): CmsEnvironment => ({
  mode: "build",
  payloadSecret: "geo-foundry-cms-build-only-secret",
  postgres: {
    connectionString:
      "postgresql://build:build@127.0.0.1:1/geo_foundry?application_name=geo-foundry-cms-build&options=-c+search_path%3Dgeo_foundry",
    schema: CMS_POSTGRES_SCHEMA,
  },
  rustfs: {
    accessKeyId: "build-only-access-key",
    bucket: CMS_BUCKET,
    endpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
    mediaPrefix: CMS_MEDIA_PREFIX,
    region: RUSTFS_REGION,
    secretAccessKey: "build-only-secret-key",
  },
})

export const parseCmsEnvironment = (
  environment: Record<string, string | undefined>,
): CmsEnvironment => {
  const mode = configModeSchema.safeParse(environment["GEO_FOUNDRY_CMS_CONFIG_MODE"] ?? "runtime")
  if (!mode.success) {
    throw new CmsEnvironmentError(["GEO_FOUNDRY_CMS_CONFIG_MODE"])
  }

  const modeValue = mode.data
  switch (modeValue) {
    case "build":
      return buildEnvironment()
    case "runtime":
      return runtimeEnvironment(environment)
    default:
      return assertNever(modeValue)
  }
}

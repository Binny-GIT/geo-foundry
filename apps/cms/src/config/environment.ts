import { z } from "zod"

import {
  type CmsSharedServicesEnvironment,
  parseCmsSharedServicesEnvironment,
  SharedServicesEnvironmentError,
} from "../../../../config/shared-services.schema"
import { assertNever } from "../shared/assert-never"

export const CMS_BUCKET = "geo-foundry"
export const CMS_MEDIA_PREFIX = "objects/media"
export const CMS_POSTGRES_SCHEMA = "geo_foundry"
export const CMS_INTEGRATION_DATABASE = "geo_foundry_cms_integration"
export const RUSTFS_REGION = "us-east-1"

const configModeSchema = z.union([
  z.literal("runtime"),
  z.literal("build"),
  z.literal("integration-test"),
])
const payloadSecretSchema = z.string().min(32)

export type CmsEnvironment = {
  readonly mode: "runtime" | "build" | "integration-test"
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

const postgresConnectionString = (
  environment: CmsSharedServicesEnvironment,
  database: string,
  applicationName: string,
): string => {
  const connection = new URL("postgresql://localhost")
  connection.hostname = environment.GEO_FOUNDRY_PG_HOST
  connection.port = String(environment.GEO_FOUNDRY_PG_PORT)
  connection.username = environment.GEO_FOUNDRY_PG_USER
  connection.password = environment.GEO_FOUNDRY_PG_PASSWORD
  connection.pathname = `/${database}`
  connection.searchParams.set("application_name", applicationName)
  connection.searchParams.set("options", `-c search_path=${environment.GEO_FOUNDRY_PG_SCHEMA}`)
  return connection.toString()
}

const serviceEnvironment = (
  environment: Record<string, string | undefined>,
  mode: "runtime" | "integration-test",
): CmsEnvironment => {
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

  const integration = mode === "integration-test"
  return {
    mode,
    payloadSecret: payloadSecret.data,
    postgres: {
      connectionString: postgresConnectionString(
        sharedServices,
        integration ? CMS_INTEGRATION_DATABASE : sharedServices.GEO_FOUNDRY_PG_DATABASE,
        integration ? "geo-foundry-cms-integration-test" : "geo-foundry-cms",
      ),
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

const runtimeEnvironment = (environment: Record<string, string | undefined>): CmsEnvironment =>
  serviceEnvironment(environment, "runtime")

const integrationTestEnvironment = (
  environment: Record<string, string | undefined>,
): CmsEnvironment => serviceEnvironment(environment, "integration-test")

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
    case "integration-test":
      return integrationTestEnvironment(environment)
    case "runtime":
      return runtimeEnvironment(environment)
    default:
      return assertNever(modeValue)
  }
}

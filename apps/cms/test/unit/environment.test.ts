import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  CMS_INTEGRATION_DATABASE,
  CmsEnvironmentError,
  faultDatabaseOf,
  faultMediaPrefixOf,
  parseCmsEnvironment,
} from "../../src/config/environment"

const runtimeEnvironment = (): Record<string, string> => ({
  GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE: "postgres",
  GEO_FOUNDRY_PG_DATABASE: "geo_foundry",
  GEO_FOUNDRY_PG_HOST: "127.0.0.1",
  GEO_FOUNDRY_PG_PASSWORD: "postgres-secret-value",
  GEO_FOUNDRY_PG_PORT: "5432",
  GEO_FOUNDRY_PG_SCHEMA: "geo_foundry",
  GEO_FOUNDRY_PG_USER: "geo_foundry",
  GEO_FOUNDRY_S3_ACCESS_KEY: "rustfs-access-key",
  GEO_FOUNDRY_S3_ENDPOINT: "127.0.0.1",
  GEO_FOUNDRY_S3_FORCE_PATH_STYLE: "true",
  GEO_FOUNDRY_S3_PORT: "9000",
  GEO_FOUNDRY_S3_SECRET_KEY: "rustfs-secret-key",
  GEO_FOUNDRY_S3_SECRET_REF: "rustfs-geo-foundry-svc",
  GEO_FOUNDRY_S3_USE_SSL: "false",
  PAYLOAD_SECRET: "payload-secret-value-at-least-32-characters",
})

const fileRuntimeEnvironment = async (): Promise<{
  readonly environment: Record<string, string>
  readonly cleanup: () => Promise<void>
}> => {
  const directory = await mkdtemp(join(tmpdir(), "geo-foundry-cms-env-"))
  const credentials = {
    "cms-secret": "payload-secret-value-at-least-32-characters",
    "pg-password": "postgres-secret-value",
    "pg-user": "geo_foundry",
    "s3-access-key": "rustfs-access-key",
    "s3-secret-key": "rustfs-secret-key",
  } as const
  await Promise.all(
    Object.entries(credentials).map(async ([name, value]) => {
      const path = join(directory, name)
      await writeFile(path, value, { mode: 0o600 })
      await chmod(path, 0o600)
    }),
  )
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    environment: {
      GEO_FOUNDRY_CMS_CONFIG_MODE: "runtime",
      GEO_FOUNDRY_CREDENTIAL_MODE: "file",
      GEO_FOUNDRY_CMS_SECRET_FILE: join(directory, "cms-secret"),
      GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE: "postgres",
      GEO_FOUNDRY_PG_DATABASE: "geo_foundry",
      GEO_FOUNDRY_PG_HOST: "127.0.0.1",
      GEO_FOUNDRY_PG_PASSWORD_FILE: join(directory, "pg-password"),
      GEO_FOUNDRY_PG_PORT: "5432",
      GEO_FOUNDRY_PG_SCHEMA: "geo_foundry",
      GEO_FOUNDRY_PG_USER_FILE: join(directory, "pg-user"),
      GEO_FOUNDRY_S3_ACCESS_KEY_FILE: join(directory, "s3-access-key"),
      GEO_FOUNDRY_S3_ENDPOINT: "127.0.0.1",
      GEO_FOUNDRY_S3_FORCE_PATH_STYLE: "true",
      GEO_FOUNDRY_S3_PORT: "9000",
      GEO_FOUNDRY_S3_SECRET_KEY_FILE: join(directory, "s3-secret-key"),
      GEO_FOUNDRY_S3_SECRET_REF: "rustfs-geo-foundry-svc",
      GEO_FOUNDRY_S3_USE_SSL: "false",
    },
  }
}

const captureCmsEnvironmentError = (
  environment: Record<string, string | undefined>,
): CmsEnvironmentError => {
  try {
    parseCmsEnvironment(environment)
  } catch (error) {
    if (error instanceof CmsEnvironmentError) {
      return error
    }
    throw error
  }
  throw new TypeError("expected CmsEnvironmentError")
}

describe("CMS environment", () => {
  it("Given build mode, when parsed, then it uses non-runtime fixed endpoints", () => {
    const parsed = parseCmsEnvironment({ GEO_FOUNDRY_CMS_CONFIG_MODE: "build" })

    expect(parsed.mode).toBe("build")
    expect(parsed.rustfs.endpoint).toBe("http://127.0.0.1:9000")
    expect(parsed.rustfs.forcePathStyle).toBe(true)
    expect(parsed.postgres.schema).toBe("geo_foundry")
  })

  it("Given integration-test mode, when parsed, then it uses the fixed isolated database", () => {
    const parsed = parseCmsEnvironment({
      ...runtimeEnvironment(),
      GEO_FOUNDRY_CMS_CONFIG_MODE: "integration-test",
      GEO_FOUNDRY_PG_DATABASE: "geo_foundry",
    })

    expect(parsed.mode).toBe("integration-test")
    expect(new URL(parsed.postgres.connectionString).pathname).toBe(`/${CMS_INTEGRATION_DATABASE}`)
    expect(new URL(parsed.postgres.connectionString).searchParams.get("application_name")).toBe(
      "geo-foundry-cms-integration-test",
    )
  })

  it("Given a valid fault run, when parsed, then it uses only run-derived database and media names", () => {
    const runId = "todo39-abc123def456ghi789j0"
    const parsed = parseCmsEnvironment({
      ...runtimeEnvironment(),
      GEO_FOUNDRY_CMS_CONFIG_MODE: "fault-test",
      GEO_FOUNDRY_FAULT_RUN_ID: runId,
    })

    expect(parsed.mode).toBe("fault-test")
    expect(new URL(parsed.postgres.connectionString).pathname).toBe(`/${faultDatabaseOf(runId)}`)
    expect(new URL(parsed.postgres.connectionString).searchParams.get("application_name")).toBe(
      `geo-foundry-cms-fault-${runId}`,
    )
    expect(parsed.rustfs.mediaPrefix).toBe(faultMediaPrefixOf(runId))
  })

  it("Given a fault mode without a valid run id, when parsed, then it fails closed", () => {
    const error = captureCmsEnvironmentError({
      ...runtimeEnvironment(),
      GEO_FOUNDRY_CMS_CONFIG_MODE: "fault-test",
      GEO_FOUNDRY_FAULT_RUN_ID: "shared",
    })

    expect(error.variables).toEqual(["GEO_FOUNDRY_FAULT_RUN_ID"])
  })

  it("Given runtime config, when a PostgreSQL variable is absent, then parsing fails by variable name", () => {
    const environment = runtimeEnvironment()
    delete environment["GEO_FOUNDRY_PG_PASSWORD"]

    const error = captureCmsEnvironmentError(environment)

    expect(error.message).toBe("CMS_ENV_INVALID")
    expect(error.variables).toEqual(["GEO_FOUNDRY_PG_PASSWORD"])
  })

  it("Given FILE-only runtime credentials, when parsed, then it resolves owner-only files", async () => {
    const fixture = await fileRuntimeEnvironment()
    try {
      const parsed = parseCmsEnvironment(fixture.environment)

      expect(parsed.mode).toBe("runtime")
      expect(new URL(parsed.postgres.connectionString).username).toBe("geo_foundry")
      expect(parsed.rustfs.accessKeyId).toBe("rustfs-access-key")
      expect(parsed.payloadSecret).toBe("payload-secret-value-at-least-32-characters")
    } finally {
      await fixture.cleanup()
    }
  })

  it("Given FILE-only runtime credentials, when a direct secret is present, then parsing rejects it", async () => {
    const fixture = await fileRuntimeEnvironment()
    try {
      const error = captureCmsEnvironmentError({
        ...fixture.environment,
        PAYLOAD_SECRET: "must-not-be-accepted",
      })

      expect(error.variables).toEqual(["PAYLOAD_SECRET"])
    } finally {
      await fixture.cleanup()
    }
  })

  it("Given FILE-only runtime credentials, when a credential file is insecure, then parsing fails closed", async () => {
    const fixture = await fileRuntimeEnvironment()
    try {
      const passwordPath = fixture.environment["GEO_FOUNDRY_PG_PASSWORD_FILE"]
      if (passwordPath === undefined) throw new Error("test credential path missing")
      await chmod(passwordPath, 0o644)
      const error = captureCmsEnvironmentError(fixture.environment)

      expect(error.variables).toEqual(["GEO_FOUNDRY_PG_PASSWORD_FILE"])
    } finally {
      await fixture.cleanup()
    }
  })

  it("Given runtime config, when path-style storage is disabled, then parsing fails closed", () => {
    const environment = runtimeEnvironment()
    environment["GEO_FOUNDRY_S3_FORCE_PATH_STYLE"] = "false"

    const error = captureCmsEnvironmentError(environment)

    expect(error.variables).toEqual(["GEO_FOUNDRY_S3_FORCE_PATH_STYLE"])
  })
})

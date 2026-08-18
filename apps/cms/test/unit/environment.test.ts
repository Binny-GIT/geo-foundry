import { describe, expect, it } from "vitest"

import { CmsEnvironmentError, parseCmsEnvironment } from "../../src/config/environment"

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

  it("Given runtime config, when a PostgreSQL variable is absent, then parsing fails by variable name", () => {
    const environment = runtimeEnvironment()
    delete environment["GEO_FOUNDRY_PG_PASSWORD"]

    const error = captureCmsEnvironmentError(environment)

    expect(error.message).toBe("CMS_ENV_INVALID")
    expect(error.variables).toEqual(["GEO_FOUNDRY_PG_PASSWORD"])
  })

  it("Given runtime config, when path-style storage is disabled, then parsing fails closed", () => {
    const environment = runtimeEnvironment()
    environment["GEO_FOUNDRY_S3_FORCE_PATH_STYLE"] = "false"

    const error = captureCmsEnvironmentError(environment)

    expect(error.variables).toEqual(["GEO_FOUNDRY_S3_FORCE_PATH_STYLE"])
  })
})

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { optionalWorkerCredential, workerCredentialOf } from "../../src/config/credentials.js"
import { parseWorkerRedisOptions } from "../../src/config/redis.js"
import { parseWorkerS3Options } from "../../src/processors/release-pipeline.js"

const fixtureOf = async (): Promise<{
  readonly environment: Record<string, string>
  readonly cleanup: () => Promise<void>
}> => {
  const directory = await mkdtemp(join(tmpdir(), "geo-foundry-worker-credentials-"))
  const values = {
    "content-service-api-key": "content-service-test-key",
    "redis-password": "redis-test-password",
    "s3-access-key": "s3-test-access-key",
    "s3-secret-key": "s3-test-secret-key",
  } as const
  await Promise.all(
    Object.entries(values).map(async ([name, value]) => {
      const path = join(directory, name)
      await writeFile(path, value, { mode: 0o600 })
      await chmod(path, 0o600)
    }),
  )
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    environment: {
      CONTENT_SERVICE_API_KEY_FILE: join(directory, "content-service-api-key"),
      GEO_FOUNDRY_CREDENTIAL_MODE: "file",
      GEO_FOUNDRY_REDIS_HOST: "127.0.0.1",
      GEO_FOUNDRY_REDIS_PASSWORD_FILE: join(directory, "redis-password"),
      GEO_FOUNDRY_S3_ACCESS_KEY_FILE: join(directory, "s3-access-key"),
      GEO_FOUNDRY_S3_SECRET_KEY_FILE: join(directory, "s3-secret-key"),
    },
  }
}

describe("Worker owner-only credentials", () => {
  it("loads content-service, Redis, and S3 credentials from FILE references", async () => {
    const fixture = await fixtureOf()
    try {
      expect(workerCredentialOf(fixture.environment, "CONTENT_SERVICE_API_KEY")).toBe(
        "content-service-test-key",
      )
      expect(parseWorkerRedisOptions(fixture.environment)).toMatchObject({
        host: "127.0.0.1",
        password: "redis-test-password",
      })
      expect(
        parseWorkerS3Options(fixture.environment, (name) =>
          workerCredentialOf(fixture.environment, name),
        ),
      ).toMatchObject({
        accessKeyId: "s3-test-access-key",
        secretAccessKey: "s3-test-secret-key",
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects direct credentials in FILE-only mode", async () => {
    const fixture = await fixtureOf()
    try {
      expect(() =>
        workerCredentialOf(
          { ...fixture.environment, CONTENT_SERVICE_API_KEY: "must-not-be-accepted" },
          "CONTENT_SERVICE_API_KEY",
        ),
      ).toThrow("WORKER_CREDENTIAL_DIRECT_FORBIDDEN:CONTENT_SERVICE_API_KEY")
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects insecure credential files without leaking their content", async () => {
    const fixture = await fixtureOf()
    try {
      const path = fixture.environment["GEO_FOUNDRY_REDIS_PASSWORD_FILE"]
      await chmod(path, 0o644)
      expect(() => optionalWorkerCredential(fixture.environment, "GEO_FOUNDRY_REDIS_PASSWORD")).toThrow(
        "WORKER_CREDENTIAL_FILE_INSECURE:GEO_FOUNDRY_REDIS_PASSWORD_FILE",
      )
    } finally {
      await fixture.cleanup()
    }
  })
})

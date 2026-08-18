import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { parseSharedServicesEnvironment } from "../config/shared-services.schema.ts"
import { acquireProjectLock } from "../scripts/shared-services/lock.mjs"
import {
  assertManifestForRun,
  createManifest,
  resourcesForRun,
  SharedServicesError,
} from "../scripts/shared-services/resources.mjs"
import { cleanupS3, createS3ClientConfig } from "../scripts/shared-services/storage.mjs"

const repositoryRoot = new URL("../", import.meta.url)
const checkScript = new URL("scripts/shared-services/check.mjs", repositoryRoot)
const secureRunScript = new URL("scripts/shared-services/secure-run.mjs", repositoryRoot)
const safeEnvironment = {
  GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE: "postgres",
  GEO_FOUNDRY_PG_DATABASE: "geo_foundry",
  GEO_FOUNDRY_PG_HOST: "127.0.0.1",
  GEO_FOUNDRY_PG_PASSWORD: "p".repeat(24),
  GEO_FOUNDRY_PG_PORT: "5432",
  GEO_FOUNDRY_PG_SCHEMA: "geo_foundry",
  GEO_FOUNDRY_PG_USER: "test-user",
  GEO_FOUNDRY_REDIS_DATABASE: "0",
  GEO_FOUNDRY_REDIS_HOST: "127.0.0.1",
  GEO_FOUNDRY_REDIS_PASSWORD: "r".repeat(24),
  GEO_FOUNDRY_REDIS_PORT: "6379",
  GEO_FOUNDRY_S3_ACCESS_KEY: "a".repeat(20),
  GEO_FOUNDRY_S3_ENDPOINT: "127.0.0.1",
  GEO_FOUNDRY_S3_FORCE_PATH_STYLE: "true",
  GEO_FOUNDRY_S3_PORT: "9000",
  GEO_FOUNDRY_S3_SECRET_KEY: "s".repeat(40),
  GEO_FOUNDRY_S3_SECRET_REF: "rustfs-geo-foundry-svc",
  GEO_FOUNDRY_S3_USE_SSL: "false",
}

test("Given the shared RustFS service When dependencies are inspected Then only the pinned AWS S3 client is used", () => {
  const packageJson = JSON.parse(readFileSync(new URL("package.json", repositoryRoot), "utf8"))

  assert.equal(packageJson.dependencies["@aws-sdk/client-s3"], "3.1112.0")
})

test("Given host-published shared services When the environment is parsed Then path-style RustFS is mandatory", () => {
  const environment = parseSharedServicesEnvironment(safeEnvironment)
  const clientConfig = createS3ClientConfig(environment)

  assert.equal(environment.GEO_FOUNDRY_PG_HOST, "127.0.0.1")
  assert.equal(environment.GEO_FOUNDRY_REDIS_HOST, "127.0.0.1")
  assert.equal(clientConfig.endpoint, "http://127.0.0.1:9000")
  assert.equal(clientConfig.forcePathStyle, true)
})

test("Given path-style is disabled When the environment is parsed Then configuration fails closed", () => {
  assert.throws(() =>
    parseSharedServicesEnvironment({
      ...safeEnvironment,
      GEO_FOUNDRY_S3_FORCE_PATH_STYLE: "false",
    }),
  )
})

test("Given missing shared-service variables When the check CLI runs Then it fails with a stable remediation code", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(checkScript)], {
    cwd: fileURLToPath(repositoryRoot),
    encoding: "utf8",
    env: {},
  })

  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stderr).code, "SHARED_SERVICE_ENV_MISSING")
})

test("Given only credential values are missing When the check CLI runs Then it names variables without values", () => {
  const environment = Object.fromEntries(
    Object.entries(safeEnvironment).filter(
      ([key]) => key !== "GEO_FOUNDRY_S3_ACCESS_KEY" && key !== "GEO_FOUNDRY_S3_SECRET_KEY",
    ),
  )
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(checkScript), "--run-id", "task-2-missing-credentials"],
    {
      cwd: fileURLToPath(repositoryRoot),
      encoding: "utf8",
      env: environment,
    },
  )
  const failure = JSON.parse(result.stderr)

  assert.equal(result.status, 1)
  assert.equal(failure.code, "SHARED_SERVICE_ENV_MISSING")
  assert.deepEqual(failure.variables, ["GEO_FOUNDRY_S3_ACCESS_KEY", "GEO_FOUNDRY_S3_SECRET_KEY"])
  assert.equal(result.stderr.includes(safeEnvironment.GEO_FOUNDRY_PG_PASSWORD), false)
  assert.equal(result.stderr.includes(safeEnvironment.GEO_FOUNDRY_REDIS_PASSWORD), false)
})

test("Given missing credential file references When the secure runner starts Then it fails before reading values", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(secureRunScript), "check"], {
    cwd: fileURLToPath(repositoryRoot),
    encoding: "utf8",
    env: {},
  })
  const failure = JSON.parse(result.stderr)

  assert.equal(result.status, 1)
  assert.equal(failure.code, "SHARED_SERVICE_ENV_MISSING")
  assert.deepEqual(failure.variables, [
    "GEO_FOUNDRY_S3_ACCESS_KEY_FILE",
    "GEO_FOUNDRY_S3_SECRET_KEY_FILE",
  ])
})

test("Given a run ID When resources are derived Then every object stays in its exact permitted prefix", () => {
  const resources = resourcesForRun("task-2-prefix")

  assert.equal(resources.s3.prefix, "objects/task-2-prefix/")
  assert.deepEqual(
    resources.s3.objects.map((object) => object.key),
    ["objects/task-2-prefix/connectivity.json", "objects/task-2-prefix/pointer/current.json"],
  )
})

test("Given a foreign prefix in a manifest When cleanup ownership is checked Then it is refused", () => {
  const manifest = createManifest("task-2-prefix")
  manifest.resources.s3.objects[0].key = "objects/foreign/connectivity.json"

  assert.throws(
    () => assertManifestForRun(manifest, "task-2-prefix"),
    (error) =>
      error instanceof SharedServicesError && error.code === "SHARED_SERVICE_FOREIGN_PREFIX",
  )
})

test("Given a manifest for one run When cleanup receives another run ID Then it is refused", () => {
  const manifest = createManifest("task-2-manifest")

  assert.throws(
    () => assertManifestForRun(manifest, "task-2-other"),
    (error) =>
      error instanceof SharedServicesError && error.code === "SHARED_SERVICE_MANIFEST_MISMATCH",
  )
})

test("Given an augmented manifest When cleanup validates it Then unknown resource fields are refused", () => {
  const manifest = createManifest("task-2-augmented")
  manifest.resources.s3.bucketCreated = true

  assert.throws(
    () => assertManifestForRun(manifest, "task-2-augmented"),
    (error) =>
      error instanceof SharedServicesError && error.code === "SHARED_SERVICE_MANIFEST_MISMATCH",
  )
})

test("Given an approved manifest When S3 cleanup runs Then it deletes only listed objects and never a bucket", async () => {
  const manifest = createManifest("task-2-cleanup")
  const commands = []
  const fakeClient = {
    destroy() {},
    async send(command) {
      commands.push(command)
      return { $metadata: { httpStatusCode: 204 } }
    },
  }

  const deleted = await cleanupS3(safeEnvironment, manifest, fakeClient)

  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["DeleteObjectCommand", "DeleteObjectCommand"],
  )
  assert.deepEqual(
    deleted.map((object) => object.key),
    manifest.resources.s3.objects.map((object) => object.key),
  )
})

test("Given a project-scoped lock When another run starts Then it fails fast", async () => {
  const releaseLock = await acquireProjectLock("task-2-lock-one")
  try {
    await assert.rejects(
      () => acquireProjectLock("task-2-lock-two"),
      (error) =>
        error instanceof SharedServicesError && error.code === "SHARED_SERVICE_LOCK_COLLISION",
    )
  } finally {
    await releaseLock()
  }
})

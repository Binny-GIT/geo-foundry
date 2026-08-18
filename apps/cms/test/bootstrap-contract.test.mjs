import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"

const packageJsonUrl = new URL("../package.json", import.meta.url)
const rootPackageJsonUrl = new URL("../../../package.json", import.meta.url)
const turboConfigUrl = new URL("../../../turbo.json", import.meta.url)
const rootTsconfigUrl = new URL("../../../tsconfig.base.json", import.meta.url)
const cmsTsconfigUrl = new URL("../tsconfig.json", import.meta.url)
const typecheckExceptionUrl = new URL("../third-party-typecheck-exception.json", import.meta.url)
const migrationIndexUrl = new URL("../src/migrations/index.ts", import.meta.url)
const migrationSourceUrl = new URL(
  "../src/migrations/20260818_023834_task9_bootstrap.ts",
  import.meta.url,
)
const migrationSnapshotUrl = new URL(
  "../src/migrations/20260818_023834_task9_bootstrap.json",
  import.meta.url,
)
const readinessUrl = new URL("../src/readiness/check-readiness.ts", import.meta.url)
const payloadConfigUrl = new URL("../src/config/database.ts", import.meta.url)
const secureRunUrl = new URL("../scripts/secure-run.mjs", import.meta.url)
const createMigrationUrl = new URL("../scripts/create-migration.mjs", import.meta.url)

const payloadPackages = [
  "payload",
  "@payloadcms/db-postgres",
  "@payloadcms/plugin-multi-tenant",
  "@payloadcms/richtext-lexical",
  "@payloadcms/storage-s3",
  "@payloadcms/next",
]

test("Given Todo 9 package config, when inspected, then Payload packages are exactly 3.88.0", async () => {
  const manifest = JSON.parse(await readFile(packageJsonUrl, "utf8"))

  for (const packageName of payloadPackages) {
    assert.equal(manifest.dependencies?.[packageName], "3.88.0")
  }
})

test("Given Todo 9 migration workflow, when inspected, then a checked-in migration index exists", async () => {
  const migrationIndex = await readFile(migrationIndexUrl, "utf8")

  assert.match(migrationIndex, /export const migrations/)
})

test("Given real integration tasks, when Turbo is inspected, then cache replay is disabled and a fresh root command exists", async () => {
  const [rootManifest, turbo] = await Promise.all([
    readFile(rootPackageJsonUrl, "utf8").then(JSON.parse),
    readFile(turboConfigUrl, "utf8").then(JSON.parse),
  ])

  assert.equal(turbo.tasks?.["test:integration"]?.cache, false)
  assert.equal(
    rootManifest.scripts?.["test:integration:fresh"],
    "turbo run test:integration --force --output-logs=full",
  )
})

test("Given the Todo 9 migration, when its snapshot and SQL are inspected, then exactly nine schema-qualified tables exist", async () => {
  const [migrationSource, snapshot] = await Promise.all([
    readFile(migrationSourceUrl, "utf8"),
    readFile(migrationSnapshotUrl, "utf8").then(JSON.parse),
  ])
  const tableNames = Object.values(snapshot.tables)
    .map((table) => table.name)
    .sort()

  assert.deepEqual(tableNames, [
    "bootstrap_admins",
    "bootstrap_admins_sessions",
    "bootstrap_media",
    "payload_kv",
    "payload_locked_documents",
    "payload_locked_documents_rels",
    "payload_migrations",
    "payload_preferences",
    "payload_preferences_rels",
  ])
  assert.equal(
    Object.values(snapshot.tables).every((table) => table.schema === "geo_foundry"),
    true,
  )
  assert.equal(
    [
      ...migrationSource.matchAll(
        /(?:CREATE TABLE|ALTER TABLE|REFERENCES|ON|DROP TABLE)\s+("[^"]+"\."[^"]+")/g,
      ),
    ].every(([, target]) => target.startsWith('"geo_foundry".')),
    true,
  )
})

test("Given strict TypeScript policy, when configs are inspected, then only the documented CMS dependency exception remains", async () => {
  const [rootTsconfig, cmsTsconfig, exception] = await Promise.all([
    readFile(rootTsconfigUrl, "utf8").then(JSON.parse),
    readFile(cmsTsconfigUrl, "utf8").then(JSON.parse),
    readFile(typecheckExceptionUrl, "utf8").then(JSON.parse),
  ])

  assert.equal(Object.hasOwn(rootTsconfig.compilerOptions, "skipLibCheck"), false)
  assert.equal(cmsTsconfig.compilerOptions?.skipLibCheck, true)
  assert.deepEqual(
    {
      compilerOption: exception.compilerOption,
      enabled: exception.enabled,
      scope: exception.scope,
    },
    { compilerOption: "skipLibCheck", enabled: true, scope: "@geo/cms" },
  )
  assert.deepEqual(exception.versions, {
    "@payloadcms/db-postgres": "3.88.0",
    next: "16.3.0",
    payload: "3.88.0",
    typescript: "5.9.3",
  })
})

test("Given Todo 9 readiness contract, when inspected, then dependency readiness is implemented", async () => {
  const readiness = await readFile(readinessUrl, "utf8")

  assert.match(readiness, /checkReadiness/)
})

test("Given migration policy, when inspected, then database push is disabled", async () => {
  const adapterConfig = await readFile(payloadConfigUrl, "utf8")

  assert.match(adapterConfig, /push: false/)
})

test("Given secure command runner, when db push is requested, then it is refused before credentials", () => {
  const result = spawnSync(process.execPath, [secureRunUrl.pathname, "payload", "push"], {
    encoding: "utf8",
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CMS_COMMAND_NOT_PERMITTED/)
})

test("Given CI, when migration generation is requested, then schema generation is refused", () => {
  const result = spawnSync(process.execPath, [createMigrationUrl.pathname, "new-migration"], {
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CMS_MIGRATION_GENERATION_FORBIDDEN/)
})

test("Given missing credential files, when secure startup fails, then secret values are not emitted", () => {
  const secretValue = "must-not-appear-in-diagnostics"
  const result = spawnSync(process.execPath, [secureRunUrl.pathname, "next", "start"], {
    encoding: "utf8",
    env: { ...process.env, GEO_FOUNDRY_PG_PASSWORD: secretValue },
  })

  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stderr, new RegExp(secretValue))
  assert.match(result.stderr, /CMS_CREDENTIAL_FILE_MISSING/)
})

test("Given the CMS secure runner, when credential mappings are inspected, then PostgreSQL also uses file references", async () => {
  const secureRunner = await readFile(secureRunUrl, "utf8")

  assert.match(secureRunner, /GEO_FOUNDRY_PG_USER_FILE/)
  assert.match(secureRunner, /GEO_FOUNDRY_PG_PASSWORD_FILE/)
  assert.match(secureRunner, /pg-server-mk-dev-existing-auth/)
})

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"

const packageJsonUrl = new URL("../package.json", import.meta.url)
const rootTsconfigUrl = new URL("../../../tsconfig.base.json", import.meta.url)
const cmsTsconfigUrl = new URL("../tsconfig.json", import.meta.url)
const typecheckExceptionUrl = new URL("../third-party-typecheck-exception.json", import.meta.url)
const migrationJournalUrl = new URL("../drizzle/meta/_journal.json", import.meta.url)
const readinessUrl = new URL("../src/readiness/check-readiness.ts", import.meta.url)
const secureRunUrl = new URL("../scripts/secure-run.mjs", import.meta.url)

const payloadPackages = [
  "payload",
  "@payloadcms/db-postgres",
  "@payloadcms/plugin-multi-tenant",
  "@payloadcms/richtext-lexical",
  "@payloadcms/storage-s3",
  "@payloadcms/next",
  "@payloadcms/ui",
]

const queuePackages = ["bullmq", "ioredis"]

test("Given the de-Payload backend, when the manifest is inspected, then no Payload package remains", async () => {
  const manifest = JSON.parse(await readFile(packageJsonUrl, "utf8"))
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }

  for (const packageName of payloadPackages) {
    assert.equal(Object.hasOwn(declared, packageName), false, packageName)
  }
  for (const packageName of queuePackages) {
    assert.equal(Object.hasOwn(declared, packageName), false, packageName)
  }
  assert.equal(typeof declared["drizzle-orm"], "string")
  assert.equal(typeof declared["drizzle-kit"], "string")
  assert.equal(typeof declared["pg-boss"], "string")
})

test("Given the Drizzle migration workflow, when inspected, then a checked-in journal lists every migration", async () => {
  const journal = JSON.parse(await readFile(migrationJournalUrl, "utf8"))

  assert.equal(journal.dialect, "postgresql")
  assert.ok(Array.isArray(journal.entries) && journal.entries.length >= 2)
  for (const entry of journal.entries) {
    await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8")
  }
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
})

test("Given the readiness contract, when inspected, then dependency readiness is implemented", async () => {
  const readiness = await readFile(readinessUrl, "utf8")

  assert.match(readiness, /checkReadiness/)
})

test("Given the secure command runner, when an unknown command is requested, then it is refused before credentials", () => {
  const result = spawnSync(process.execPath, [secureRunUrl.pathname, "drizzle-kit", "push"], {
    encoding: "utf8",
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CMS_COMMAND_NOT_PERMITTED/)
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

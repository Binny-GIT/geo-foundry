import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const repositoryRoot = new URL("../", import.meta.url)

const readJson = async (relativePath) => {
  const content = await readFile(new URL(relativePath, repositoryRoot), "utf8")
  return JSON.parse(content)
}

const readText = (relativePath) => readFile(new URL(relativePath, repositoryRoot), "utf8")

test("Given the governed repository When its toolchain configuration is inspected Then every pinned contract exists", async () => {
  const packageJson = await readJson("package.json")
  const tsconfig = await readJson("tsconfig.base.json")
  const biomeConfig = await readJson("biome.json")
  const workspaceConfig = await readText("pnpm-workspace.yaml")
  const pnpmConfig = await readText(".npmrc")
  const turboConfig = await readJson("turbo.json")

  assert.equal(process.versions.node.split(".")[0], "24")
  assert.equal(packageJson.type, "module")
  assert.equal(packageJson.packageManager, "pnpm@11.22.0")
  assert.equal(packageJson.devDependencies.turbo, "2.10.10")
  assert.equal(packageJson.devDependencies.typescript, "5.9.3")
  assert.equal(packageJson.devDependencies["@biomejs/biome"], "2.5.8")
  assert.equal(packageJson.devDependencies["@microsoft/api-extractor"], "7.58.12")

  for (const script of [
    "format",
    "lint",
    "typecheck",
    "test",
    "test:integration",
    "test:e2e",
    "test:faults",
    "test:faults:contracts",
    "ci:verify",
    "test:ci-contracts",
    "build",
    "api:check",
    "check",
    "dev",
    "packages:pack-smoke:task6:npm",
    "packages:pack-smoke:task6:pnpm",
    "test:task6:coverage",
  ]) {
    assert.equal(typeof packageJson.scripts[script], "string")
  }

  assert.match(workspaceConfig, /apps\/\*/)
  assert.match(workspaceConfig, /packages\/\*/)
  assert.match(workspaceConfig, /examples\/\*/)
  assert.match(workspaceConfig, /msgpackr-extract: true/)
  assert.match(pnpmConfig, /engine-strict=true/)
  assert.match(pnpmConfig, /prefer-frozen-lockfile=true/)
  assert.equal(tsconfig.compilerOptions.strict, true)
  assert.equal(tsconfig.compilerOptions.noUncheckedIndexedAccess, true)
  assert.equal(tsconfig.compilerOptions.exactOptionalPropertyTypes, true)
  assert.equal(tsconfig.compilerOptions.noImplicitOverride, true)
  assert.equal(tsconfig.compilerOptions.noFallthroughCasesInSwitch, true)
  assert.equal(tsconfig.compilerOptions.noImplicitReturns, true)
  assert.equal(tsconfig.compilerOptions.useUnknownInCatchVariables, true)
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true)
  assert.equal(tsconfig.compilerOptions.isolatedModules, true)
  assert.equal(biomeConfig.linter.enabled, true)
  assert.deepEqual(Object.keys(turboConfig.tasks).sort(), [
    "build",
    "dev",
    "lint",
    "test",
    "test:e2e",
    "test:faults",
    "test:integration",
    "typecheck",
  ])

  for (const workspace of ["apps", "packages", "examples"]) {
    const manifest = await readJson(`${workspace}/package.json`)
    assert.equal(manifest.type, "module")
    assert.deepEqual(manifest.exports, { "./package.json": "./package.json" })
  }
})

test("Given every Vitest entrypoint When its command is inspected Then runner config loading prevents package-local temp bundles", async () => {
  const packageJson = await readJson("package.json")
  const packagePaths = [
    "packages/domain/package.json",
    "packages/publisher/package.json",
    "packages/schema/package.json",
    "packages/testing/package.json",
  ]
  const packageManifests = await Promise.all(packagePaths.map((path) => readJson(path)))

  for (const command of [
    packageJson.scripts["test:workspace:fresh"],
    ...packageManifests.flatMap((manifest) =>
      Object.values(manifest.scripts).filter((script) => script.includes("vitest")),
    ),
  ]) {
    assert.match(command, /--configLoader runner/)
  }
})

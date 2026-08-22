import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const packageManager = process.argv[2]

if (packageManager !== "pnpm" && packageManager !== "npm") {
  throw new Error("Expected package manager argument: pnpm or npm")
}

const run = (command, argumentsList, cwd) => {
  const result = spawnSync(command, argumentsList, { cwd, encoding: "utf8", stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 1}`)
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), `geo-foundry-task6-${packageManager}-`))

try {
  const packageDirectory = join(temporaryRoot, "packages")
  const consumerDirectory = join(temporaryRoot, "consumer")
  await Promise.all([mkdir(packageDirectory), mkdir(consumerDirectory)])

  for (const packageName of ["@geo/schema", "@geo/compiler", "@geo/publisher"]) {
    run(
      "pnpm",
      ["--filter", packageName, "pack", "--pack-destination", packageDirectory],
      repositoryRoot,
    )
  }

  const tarballs = await readdir(packageDirectory)
  const schemaTarball = tarballs.find((name) => name.startsWith("geo-schema-"))
  const compilerTarball = tarballs.find((name) => name.startsWith("geo-compiler-"))
  const publisherTarball = tarballs.find((name) => name.startsWith("geo-publisher-"))
  if (
    schemaTarball === undefined ||
    compilerTarball === undefined ||
    publisherTarball === undefined
  ) {
    throw new Error("Expected packed schema, compiler, and publisher tarballs")
  }

  const schemaPackage = `file:${join(packageDirectory, schemaTarball)}`
  const compilerPackage = `file:${join(packageDirectory, compilerTarball)}`
  const publisherPackage = `file:${join(packageDirectory, publisherTarball)}`
  const packageJson = {
    name: `geo-foundry-task6-${packageManager}-consumer`,
    packageManager: "pnpm@11.22.0",
    private: true,
    type: "module",
    dependencies: {
      "@geo/compiler": compilerPackage,
      "@geo/publisher": publisherPackage,
      "@geo/schema": schemaPackage,
    },
  }

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  if (packageManager === "pnpm") {
    await writeFile(
      join(consumerDirectory, "pnpm-workspace.yaml"),
      `packages:\n  - "."\noverrides:\n  "@geo/compiler@0.0.0": "${compilerPackage}"\n  "@geo/schema@0.0.0": "${schemaPackage}"\n`,
    )
  }
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          noUncheckedIndexedAccess: true,
          strict: true,
          target: "ES2024",
          verbatimModuleSyntax: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerDirectory, "consumer.ts"),
    `import type { ReleaseObjectKey, VerifiedReleaseReference } from "@geo/schema/release/v1"
import type {
  CompareAndSwapCurrentPointerRequest,
  CreateCurrentPointerRequest,
  CreateIfAbsentRequest,
} from "@geo/publisher/artifact-store"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

const createKeyIsExact: Equal<CreateIfAbsentRequest["key"], ReleaseObjectKey> = true
const initialFieldsAreExact: Equal<keyof CreateCurrentPointerRequest, "pointer"> = true
const casFieldsAreExact: Equal<
  keyof CompareAndSwapCurrentPointerRequest,
  "expectedEtag" | "pointer"
> = true
const plainObjectIsNotProof: Equal<
  { readonly manifestSha256: string; readonly releaseId: string; readonly siteId: string },
  VerifiedReleaseReference
> = false

void [createKeyIsExact, initialFieldsAreExact, casFieldsAreExact, plainObjectIsNotProof]
`,
  )
  await writeFile(
    join(consumerDirectory, "consumer.mjs"),
    `import { ReleaseV1 } from "@geo/schema"
import * as ReleaseSubpath from "@geo/schema/release/v1"
import { prepareCurrentPointerCompareAndSwap } from "@geo/publisher"
import * as ArtifactStoreSubpath from "@geo/publisher/artifact-store"

const manifest = {
  compilerVersion: "1.0.0",
  createdAt: "2026-08-17T10:00:00.000Z",
  objects: [{
    bytes: 2,
    contentType: "application/json",
    path: "pages/en-US/index.json",
    sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  }],
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
  sourceVersionIds: ["source-001"],
}
const release = await ReleaseV1.verifyManifest(manifest)
const pointer = ReleaseV1.createCurrentPointer({
  actor: ReleaseV1.AuditActorSchema.parse({ actorId: "service-publisher", kind: "service" }),
  release,
  updatedAt: ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
})
const prepared = await prepareCurrentPointerCompareAndSwap({
  expectedEtag: ReleaseV1.ETagSchema.parse('"etag-current"'),
  pointer,
})

if (
  ReleaseSubpath.verifyManifest !== ReleaseV1.verifyManifest ||
  ArtifactStoreSubpath.prepareCurrentPointerCompareAndSwap !== prepareCurrentPointerCompareAndSwap
) {
  throw new Error("Declared package subpath does not match its supported root entrypoint")
}

process.stdout.write(
  JSON.stringify({
    key: prepared.key,
    sha256: prepared.sha256,
    pointer: JSON.parse(new TextDecoder().decode(prepared.body)),
  }) + "\\n",
)
`,
  )

  if (packageManager === "pnpm") {
    run("pnpm", ["install", "--lockfile-only"], consumerDirectory)
    run("pnpm", ["install", "--frozen-lockfile"], consumerDirectory)
  } else {
    run(
      "npm",
      [
        "install",
        "--offline",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      consumerDirectory,
    )
    run(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumerDirectory,
    )
  }

  const typeScriptBinary = join(repositoryRoot, "node_modules", ".bin", "tsc")
  run(typeScriptBinary, ["--project", join(consumerDirectory, "tsconfig.json")], consumerDirectory)
  run(process.execPath, [join(consumerDirectory, "consumer.mjs")], consumerDirectory)

  const installedPublisherManifest = JSON.parse(
    await readFile(join(consumerDirectory, "node_modules/@geo/publisher/package.json"), "utf8"),
  )
  if (installedPublisherManifest.dependencies["@geo/schema"] !== "0.0.0") {
    throw new Error("Packed publisher dependency semantics changed")
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}

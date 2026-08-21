import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageManager = process.argv[2]
if (packageManager !== "pnpm" && packageManager !== "npm") {
  throw new TypeError("Expected package manager argument: pnpm or npm")
}
const reportArgumentIndex = process.argv.indexOf("--report")

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const packageNames = [
  "@geo/compiler",
  "@geo/content-client",
  "@geo/domain",
  "@geo/publisher",
  "@geo/quality-rules",
  "@geo/render-core",
  "@geo/render-react",
  "@geo/runtime",
  "@geo/schema",
  "@geo/testing",
]

function run(command, argumentsList, cwd, capture = false) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  })
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stderr)
      process.stdout.write(result.stdout)
    }
    throw new Error(`${command} exited with ${result.status ?? 1}`)
  }
  return result.stdout
}

function tarballName(packageName) {
  return `${packageName.slice(1).replace("/", "-")}-0.0.0.tgz`
}

const temporaryRoot = await mkdtemp(join(tmpdir(), `geo-foundry-task8-${packageManager}-`))

try {
  const tarballDirectory = join(temporaryRoot, "tarballs")
  const consumerDirectory = join(temporaryRoot, "consumer")
  await Promise.all([
    mkdir(tarballDirectory, { recursive: true }),
    mkdir(consumerDirectory, { recursive: true }),
  ])

  for (const packageName of packageNames) {
    run(
      "pnpm",
      ["--filter", packageName, "pack", "--pack-destination", tarballDirectory],
      repositoryRoot,
    )
  }

  const tarballs = await readdir(tarballDirectory)
  const tarballByPackage = Object.fromEntries(
    packageNames.map((packageName) => {
      const expectedName = tarballName(packageName)
      if (!tarballs.includes(expectedName)) {
        throw new Error(`Missing tarball for ${packageName}: ${expectedName}`)
      }
      return [packageName, `file:${join(tarballDirectory, expectedName)}`]
    }),
  )

  for (const packageName of packageNames) {
    const tarballPath = join(tarballDirectory, tarballName(packageName))
    const entries = run("tar", ["-tzf", tarballPath], repositoryRoot, true)
      .split("\n")
      .filter(Boolean)
    if (entries.some((entry) => entry.startsWith("package/src/"))) {
      throw new Error(`${packageName} tarball exposed source files`)
    }
    if (!entries.includes("package/package.json") || !entries.includes("package/dist/index.js")) {
      throw new Error(`${packageName} tarball omitted required ESM artifacts`)
    }
    const packedManifest = JSON.parse(
      run("tar", ["-xOzf", tarballPath, "package/package.json"], repositoryRoot, true),
    )
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const version of Object.values(packedManifest[field] ?? {})) {
        if (
          typeof version !== "string" ||
          version.startsWith("file:") ||
          version.startsWith("link:") ||
          version.startsWith("workspace:")
        ) {
          throw new Error(`${packageName} packed ${field} contains a non-publishable dependency`)
        }
      }
    }
  }

  const packageJson = {
    name: `geo-foundry-task8-${packageManager}-consumer`,
    packageManager: "pnpm@11.22.0",
    private: true,
    type: "module",
    dependencies: {
      ...tarballByPackage,
      react: "19.2.8",
      "react-dom": "19.2.8",
    },
  }
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  if (packageManager === "pnpm") {
    const overrides = packageNames
      .map((packageName) => `  "${packageName}@0.0.0": "${tarballByPackage[packageName]}"`)
      .join("\n")
    await writeFile(
      join(consumerDirectory, "pnpm-workspace.yaml"),
      `packages:\n  - "."\noverrides:\n${overrides}\n`,
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
    `import type { ArtifactStore, CompareAndSwapCurrentPointerRequest } from "@geo/publisher/artifact-store"
import type { PageDocument } from "@geo/schema"
import type { VerifiedReleaseReference } from "@geo/schema/release/v1"

type ConsumerContract = {
  readonly artifactStore: ArtifactStore
  readonly page: PageDocument
  readonly pointerRequest: CompareAndSwapCurrentPointerRequest
  readonly release: VerifiedReleaseReference
}

export type { ConsumerContract }
`,
  )
  await writeFile(
    join(consumerDirectory, "consumer.mjs"),
    `import "@geo/compiler"
import "@geo/content-client"
import "@geo/domain"
import { assertPointerEtagMatches } from "@geo/publisher/artifact-store"
import "@geo/quality-rules"
	import { renderPage } from "@geo/render-core"
	import { GeoPage } from "@geo/render-react"
	import { renderToString } from "react-dom/server"
	import "@geo/runtime"
	import { articlePageFixture, PageDocumentSchema, ReleaseV1 } from "@geo/schema"
import "@geo/testing"

	const page = PageDocumentSchema.parse(articlePageFixture)
	const html = renderToString(GeoPage({ page: renderPage(page) }))
	if (!html.includes("Portable structured content.")) {
	  throw new Error("Packed render-react consumer did not produce semantic SSR output")
	}
	const etag = ReleaseV1.ETagSchema.parse('"consumer-etag"')
if (assertPointerEtagMatches({ actualEtag: etag, expectedEtag: etag }) !== etag) {
  throw new Error("Publisher contract returned an unexpected ETag")
}

const rejected = []
for (const specifier of ["@geo/schema/src/index.js", "@geo/publisher/errors.js"]) {
  try {
    await import(specifier)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      rejected.push(specifier)
      continue
    }
    throw error
  }
  throw new Error("Deep import unexpectedly succeeded: " + specifier)
}

process.stdout.write(JSON.stringify({ pageType: page.pageType, rejected }) + "\\n")
`,
  )

  if (packageManager === "pnpm") {
    run("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], consumerDirectory)
    run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], consumerDirectory)
  } else {
    const commonArguments = [
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmmirror.com",
    ]
    run("npm", ["install", "--package-lock-only", ...commonArguments], consumerDirectory)
    run("npm", ["ci", ...commonArguments], consumerDirectory)
  }

  const typeScriptBinary = join(repositoryRoot, "node_modules", ".bin", "tsc")
  run(typeScriptBinary, ["--project", join(consumerDirectory, "tsconfig.json")], consumerDirectory)
  run(process.execPath, [join(consumerDirectory, "consumer.mjs")], consumerDirectory)
  const result = {
    deepImports: {
      "@geo/publisher/errors.js": "ERR_PACKAGE_PATH_NOT_EXPORTED",
      "@geo/schema/src/index.js": "ERR_PACKAGE_PATH_NOT_EXPORTED",
    },
    manager: packageManager,
    packages: packageNames,
    publicPublisherContract: "passed",
    publicSchemaParse: "article",
    status: "passed",
  }
  const serializedResult = `${JSON.stringify(result, null, 2)}\n`
  if (reportArgumentIndex !== -1) {
    const reportPath = process.argv[reportArgumentIndex + 1]
    if (reportPath === undefined) {
      throw new TypeError("--report requires a path")
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, serializedResult)
  }
  process.stdout.write(serializedResult)
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}

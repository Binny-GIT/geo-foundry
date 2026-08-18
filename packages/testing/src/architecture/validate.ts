import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { validatePackageImports } from "./import-rules.js"
import { pathExists } from "./imports.js"
import { isJsonObject, readJsonObject } from "./json.js"
import {
  dependencyEdges,
  type PackageContext,
  validateDependencyGraph,
  validateManifest,
} from "./manifest-rules.js"
import {
  PACKAGE_BOUNDARY_VIOLATION_CODE,
  type PackageBoundaryViolation,
  type PackageGraphEdge,
  type PackageGraphReport,
  type ValidateWorkspacePackagesOptions,
} from "./model.js"
import { PLANNED_PACKAGE_DIRECTORIES } from "./policy.js"

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en")
}

async function readPackageContexts(packagesDirectory: string): Promise<readonly PackageContext[]> {
  const entries = await readdir(packagesDirectory, { withFileTypes: true })
  const contexts: PackageContext[] = []
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const packageDirectory = join(packagesDirectory, entry.name)
    const manifestPath = join(packageDirectory, "package.json")
    if (!(await pathExists(manifestPath))) {
      continue
    }
    const manifest = await readJsonObject(manifestPath)
    if (typeof manifest["name"] !== "string") {
      continue
    }
    const tsconfigPath = join(packageDirectory, "tsconfig.json")
    const tsconfig = (await pathExists(tsconfigPath))
      ? await readJsonObject(tsconfigPath)
      : undefined
    contexts.push({
      directory: packageDirectory,
      manifest,
      name: manifest["name"],
      tsconfigCompilerOptions: isJsonObject(tsconfig?.["compilerOptions"])
        ? tsconfig["compilerOptions"]
        : Object.freeze({}),
    })
  }
  return contexts.sort((left, right) => compareText(left.name, right.name))
}

export async function validateWorkspacePackages(
  options: ValidateWorkspacePackagesOptions,
): Promise<PackageGraphReport> {
  const packagesDirectory = join(options.workspaceRoot, "packages")
  const contexts = await readPackageContexts(packagesDirectory)
  const packageByName = new Map(contexts.map((context) => [context.name, context]))
  const edges: PackageGraphEdge[] = []
  const violations: PackageBoundaryViolation[] = []
  if (options.requirePlannedPackages ?? true) {
    const packageDirectories = new Set(
      contexts.map((context) => context.directory.split("/").at(-1)),
    )
    for (const directory of PLANNED_PACKAGE_DIRECTORIES) {
      if (!packageDirectories.has(directory)) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.PLANNED_PACKAGE_MISSING,
          message: `Planned package directory is missing: ${directory}`,
          packageName: `@geo/${directory}`,
        })
      }
    }
  }
  for (const context of contexts) {
    edges.push(...dependencyEdges(context))
    violations.push(...(await validateManifest(context, options.requireBuiltExports ?? true)))
    violations.push(...validateDependencyGraph(context))
    const importReport = await validatePackageImports(context, packageByName, options.workspaceRoot)
    edges.push(...importReport.edges)
    violations.push(...importReport.violations)
  }
  return Object.freeze({
    edges: edges.sort((left, right) =>
      compareText(
        `${left.from}:${left.kind}:${left.to}`,
        `${right.from}:${right.kind}:${right.to}`,
      ),
    ),
    packages: contexts.map((context) => context.name),
    violations: violations.sort((left, right) =>
      compareText(
        `${left.code}:${left.packageName}:${left.file ?? ""}:${left.specifier ?? ""}`,
        `${right.code}:${right.packageName}:${right.file ?? ""}:${right.specifier ?? ""}`,
      ),
    ),
  })
}

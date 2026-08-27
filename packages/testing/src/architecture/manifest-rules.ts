import { join } from "node:path"

import { pathExists } from "./imports.js"
import {
  exportTargets,
  isJsonObject,
  type JsonObject,
  readStringArray,
  readStringRecord,
} from "./json.js"
import {
  PACKAGE_BOUNDARY_VIOLATION_CODE,
  type PackageBoundaryViolation,
  type PackageGraphEdge,
} from "./model.js"

export type PackageContext = {
  readonly directory: string
  readonly manifest: JsonObject
  readonly name: string
  readonly tsconfigCompilerOptions: JsonObject
}

export const dependencyKinds = [
  ["dependencies", "dependency"],
  ["optionalDependencies", "optional"],
  ["peerDependencies", "peer"],
] as const

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en")
}

export function dependencyNames(manifest: JsonObject, field: string): readonly string[] {
  return Object.keys(readStringRecord(manifest[field])).sort(compareText)
}

export function productionDependencyNames(manifest: JsonObject): readonly string[] {
  return dependencyKinds.flatMap(([field]) => dependencyNames(manifest, field)).sort(compareText)
}

export function dependencyEdges(context: PackageContext): readonly PackageGraphEdge[] {
  return dependencyKinds.flatMap(([field, kind]) =>
    dependencyNames(context.manifest, field).map((dependency) => ({
      from: context.name,
      kind,
      to: dependency,
    })),
  )
}

export async function validateManifest(
  context: PackageContext,
  requireBuiltExports: boolean,
): Promise<readonly PackageBoundaryViolation[]> {
  const violations: PackageBoundaryViolation[] = []
  const exports = context.manifest["exports"]
  if (
    context.manifest["private"] !== true ||
    context.manifest["type"] !== "module" ||
    context.manifest["main"] !== undefined ||
    !isJsonObject(exports)
  ) {
    violations.push({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.ESM_MANIFEST_INVALID,
      message: "Internal packages must be ESM-only with an explicit exports object and no main field",
      packageName: context.name,
    })
  }
  if (isJsonObject(exports)) {
    for (const [subpath, value] of Object.entries(exports)) {
      const targets = exportTargets(value)
      if (
        subpath.includes("*") ||
        targets.length === 0 ||
        targets.some(
          (target) =>
            (target !== "./package.json" && !target.startsWith("./dist/")) ||
            target.endsWith(".cjs"),
        )
      ) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.EXPORT_TARGET_INVALID,
          message: `Export ${subpath} must target an explicit ESM dist artifact`,
          packageName: context.name,
        })
      }
    }
  }
  for (const [field] of dependencyKinds) {
    for (const [dependency, version] of Object.entries(readStringRecord(context.manifest[field]))) {
      if (
        version.startsWith("file:") ||
        version.startsWith("link:") ||
        (dependency.startsWith("@geo/") && version !== "workspace:*")
      ) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.DEPENDENCY_PROTOCOL_INVALID,
          message: `${field}.${dependency} must use publish-safe version semantics`,
          packageName: context.name,
        })
      }
    }
  }
  if (requireBuiltExports && isJsonObject(exports)) {
    for (const target of Object.values(exports).flatMap(exportTargets)) {
      if (target.startsWith("./dist/") && !(await pathExists(join(context.directory, target)))) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.BUILT_EXPORT_MISSING,
          message: `Built export does not exist: ${target}`,
          packageName: context.name,
        })
      }
    }
  }
  return violations
}

export function validateDependencyGraph(
  context: PackageContext,
): readonly PackageBoundaryViolation[] {
  const violations: PackageBoundaryViolation[] = []
  const allDependencies = productionDependencyNames(context.manifest)
  if (context.name === "@geo/runtime" && JSON.stringify(allDependencies) !== '["@geo/schema"]') {
    violations.push({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.RUNTIME_DEPENDENCY_INVALID,
      message: "@geo/runtime production dependency graph must contain only @geo/schema",
      packageName: context.name,
    })
  }
  if (context.name === "@geo/render-core" && JSON.stringify(allDependencies) !== '["@geo/schema"]') {
    violations.push({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.RENDER_CORE_DEPENDENCY_INVALID,
      message: "@geo/render-core production dependency graph must contain only @geo/schema",
      packageName: context.name,
    })
  }
  const renderReactPeers = readStringRecord(context.manifest["peerDependencies"])
  if (
    context.name === "@geo/render-react" &&
    (JSON.stringify(dependencyNames(context.manifest, "dependencies")) !==
      '["@geo/render-core","@geo/schema"]' ||
      renderReactPeers["react"] !== "19.2.8" ||
      renderReactPeers["react-dom"] !== "19.2.8" ||
      Object.keys(renderReactPeers).length !== 2)
  ) {
    violations.push({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.RENDER_REACT_DEPENDENCY_INVALID,
      message: "@geo/render-react must depend on render-core/schema and peer React/ReactDOM 19.2.8",
      packageName: context.name,
    })
  }
  if (
    context.name === "@geo/schema" ||
    context.name === "@geo/runtime" ||
    context.name === "@geo/render-core"
  ) {
    const forbiddenDependencies = allDependencies.filter(
      (dependency) => dependency === "react" || dependency === "react-dom",
    )
    if (
      forbiddenDependencies.length > 0 ||
      readStringArray(context.tsconfigCompilerOptions["lib"]).includes("DOM")
    ) {
      violations.push({
        code: PACKAGE_BOUNDARY_VIOLATION_CODE.PLATFORM_DEPENDENCY_FORBIDDEN,
        message: "Schema, runtime, and render-core packages must not depend on React, ReactDOM, or DOM libraries",
        packageName: context.name,
      })
    }
  }
  return violations
}

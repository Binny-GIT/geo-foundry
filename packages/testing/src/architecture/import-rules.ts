import { join, relative } from "node:path"

import {
  importedSpecifiers,
  listTypeScriptFiles,
  packageNameFromSpecifier,
  publicSubpath,
} from "./imports.js"
import { isJsonObject } from "./json.js"
import { productionDependencyNames, type PackageContext } from "./manifest-rules.js"
import {
  PACKAGE_BOUNDARY_VIOLATION_CODE,
  type PackageBoundaryViolation,
  type PackageGraphEdge,
} from "./model.js"
import {
  CONTROL_PLANE_PACKAGES,
  isRuntimeForbiddenPackage,
  SERVING_PLANE_PACKAGES,
} from "./policy.js"

export async function validatePackageImports(
  context: PackageContext,
  packageByName: ReadonlyMap<string, PackageContext>,
  workspaceRoot: string,
): Promise<{
  readonly edges: readonly PackageGraphEdge[]
  readonly violations: readonly PackageBoundaryViolation[]
}> {
  const edges: PackageGraphEdge[] = []
  const violations: PackageBoundaryViolation[] = []
  const declaredDependencies = new Set(productionDependencyNames(context.manifest))
  for (const file of await listTypeScriptFiles(join(context.directory, "src"))) {
    for (const specifier of await importedSpecifiers(file)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) {
        continue
      }
      const importedPackage = packageNameFromSpecifier(specifier)
      edges.push({ from: context.name, kind: "import", to: importedPackage })
      if (SERVING_PLANE_PACKAGES.has(context.name) && CONTROL_PLANE_PACKAGES.has(importedPackage)) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.SERVING_IMPORTS_CONTROL_PLANE,
          file: relative(workspaceRoot, file),
          message: "Serving Plane packages cannot import Control Plane packages",
          packageName: context.name,
          specifier,
        })
      }
      if (context.name === "@geo/runtime" && isRuntimeForbiddenPackage(importedPackage)) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.RUNTIME_FORBIDDEN_IMPORT,
          file: relative(workspaceRoot, file),
          message: "Runtime cannot import compiler, CMS, quality, AI, database, or queue packages",
          packageName: context.name,
          specifier,
        })
      }
      const importedContext = packageByName.get(importedPackage)
      if (importedContext === undefined) {
        continue
      }
      const exports = importedContext.manifest["exports"]
      if (isJsonObject(exports) && !(publicSubpath(specifier) in exports)) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.PACKAGE_PATH_NOT_EXPORTED,
          file: relative(workspaceRoot, file),
          message: "Workspace imports must use a declared package export",
          packageName: context.name,
          specifier,
        })
      }
      if (!declaredDependencies.has(importedPackage)) {
        violations.push({
          code: PACKAGE_BOUNDARY_VIOLATION_CODE.PACKAGE_IMPORT_UNDECLARED,
          file: relative(workspaceRoot, file),
          message: "Workspace package imports must be declared in the package manifest",
          packageName: context.name,
          specifier,
        })
      }
    }
  }
  return Object.freeze({ edges, violations })
}

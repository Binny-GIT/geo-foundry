export const PACKAGE_BOUNDARY_VIOLATION_CODE = {
  BUILT_EXPORT_MISSING: "BUILT_EXPORT_MISSING",
  DEPENDENCY_PROTOCOL_INVALID: "DEPENDENCY_PROTOCOL_INVALID",
  ESM_MANIFEST_INVALID: "ESM_MANIFEST_INVALID",
  EXPORT_TARGET_INVALID: "EXPORT_TARGET_INVALID",
  FILES_ALLOWLIST_INVALID: "FILES_ALLOWLIST_INVALID",
  PACKAGE_IMPORT_UNDECLARED: "PACKAGE_IMPORT_UNDECLARED",
  PACKAGE_PATH_NOT_EXPORTED: "PACKAGE_PATH_NOT_EXPORTED",
  PLATFORM_DEPENDENCY_FORBIDDEN: "PLATFORM_DEPENDENCY_FORBIDDEN",
  PLANNED_PACKAGE_MISSING: "PLANNED_PACKAGE_MISSING",
  RENDER_REACT_DEPENDENCY_INVALID: "RENDER_REACT_DEPENDENCY_INVALID",
  RUNTIME_DEPENDENCY_INVALID: "RUNTIME_DEPENDENCY_INVALID",
  RUNTIME_FORBIDDEN_IMPORT: "RUNTIME_FORBIDDEN_IMPORT",
  SERVING_IMPORTS_CONTROL_PLANE: "SERVING_IMPORTS_CONTROL_PLANE",
} as const

export type PackageBoundaryViolationCode =
  (typeof PACKAGE_BOUNDARY_VIOLATION_CODE)[keyof typeof PACKAGE_BOUNDARY_VIOLATION_CODE]

export type PackageBoundaryViolation = {
  readonly code: PackageBoundaryViolationCode
  readonly file?: string
  readonly message: string
  readonly packageName: string
  readonly specifier?: string
}

export type PackageGraphEdge = {
  readonly from: string
  readonly kind: "dependency" | "import" | "optional" | "peer"
  readonly to: string
}

export type PackageGraphReport = {
  readonly edges: readonly PackageGraphEdge[]
  readonly packages: readonly string[]
  readonly violations: readonly PackageBoundaryViolation[]
}

export type ValidateWorkspacePackagesOptions = {
  readonly requireBuiltExports?: boolean
  readonly requirePlannedPackages?: boolean
  readonly workspaceRoot: string
}

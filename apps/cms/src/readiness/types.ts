export const DEPENDENCY_CODES = {
  POSTGRES_ACCESS_DENIED: "POSTGRES_ACCESS_DENIED",
  POSTGRES_CONFIG_INVALID: "POSTGRES_CONFIG_INVALID",
  POSTGRES_STATE_INVALID: "POSTGRES_STATE_INVALID",
  POSTGRES_UNAVAILABLE: "POSTGRES_UNAVAILABLE",
  RUSTFS_ACCESS_DENIED: "RUSTFS_ACCESS_DENIED",
  RUSTFS_CONFIG_INVALID: "RUSTFS_CONFIG_INVALID",
  RUSTFS_UNAVAILABLE: "RUSTFS_UNAVAILABLE",
} as const

export type DependencyCode = (typeof DEPENDENCY_CODES)[keyof typeof DEPENDENCY_CODES]
export type DependencyName = "postgres" | "rustfs"

export type DependencyStatus =
  | { readonly status: "ready" }
  | { readonly code: DependencyCode; readonly status: "misconfigured" | "unavailable" }
  | { readonly status: "unchecked" }

export type ConfigurationStatus =
  | { readonly status: "ready" }
  | {
      readonly code: "CMS_CONFIG_INVALID"
      readonly status: "misconfigured"
      readonly variables: readonly string[]
    }

export type ReadinessReport = {
  readonly configuration: ConfigurationStatus
  readonly dependencies: {
    readonly postgres: DependencyStatus
    readonly rustfs: DependencyStatus
  }
  readonly status: "not_ready" | "ready"
}

export type DependencyProbe = () => Promise<void>

export class DependencyProbeError extends Error {
  override readonly name = "DependencyProbeError"

  constructor(
    readonly dependency: DependencyName,
    readonly code: DependencyCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
  }
}

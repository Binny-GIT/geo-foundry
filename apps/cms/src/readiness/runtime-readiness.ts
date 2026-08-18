import { CmsEnvironmentError, parseCmsEnvironment } from "../config/environment"
import { checkReadiness } from "./check-readiness"
import { createPostgresProbe, createRustfsProbe } from "./probes"
import { DEPENDENCY_CODES, type DependencyStatus, type ReadinessReport } from "./types"

const dependencyConfigurationStatus = (
  variables: readonly string[],
  prefix: "GEO_FOUNDRY_PG_" | "GEO_FOUNDRY_S3_",
  code:
    | typeof DEPENDENCY_CODES.POSTGRES_CONFIG_INVALID
    | typeof DEPENDENCY_CODES.RUSTFS_CONFIG_INVALID,
): DependencyStatus =>
  variables.some((variable) => variable.startsWith(prefix))
    ? { code, status: "misconfigured" }
    : { status: "unchecked" }

export const configurationFailureReport = (variables: readonly string[]): ReadinessReport => ({
  configuration: {
    code: "CMS_CONFIG_INVALID",
    status: "misconfigured",
    variables,
  },
  dependencies: {
    postgres: dependencyConfigurationStatus(
      variables,
      "GEO_FOUNDRY_PG_",
      DEPENDENCY_CODES.POSTGRES_CONFIG_INVALID,
    ),
    rustfs: dependencyConfigurationStatus(
      variables,
      "GEO_FOUNDRY_S3_",
      DEPENDENCY_CODES.RUSTFS_CONFIG_INVALID,
    ),
  },
  status: "not_ready",
})

export const checkRuntimeReadiness = async (
  environment: Record<string, string | undefined>,
): Promise<ReadinessReport> => {
  try {
    const parsed = parseCmsEnvironment(environment)
    return checkReadiness({
      postgres: createPostgresProbe(parsed),
      rustfs: createRustfsProbe(parsed),
    })
  } catch (error) {
    if (error instanceof CmsEnvironmentError) {
      return configurationFailureReport(error.variables)
    }
    throw error
  }
}

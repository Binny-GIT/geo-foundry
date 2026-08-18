import type { DependencyProbe, DependencyStatus, ReadinessReport } from "./types"
import { DependencyProbeError } from "./types"

export type ReadinessProbes = {
  readonly postgres: DependencyProbe
  readonly rustfs: DependencyProbe
}

const checkDependency = async (probe: DependencyProbe): Promise<DependencyStatus> => {
  try {
    await probe()
    return { status: "ready" }
  } catch (error) {
    if (error instanceof DependencyProbeError) {
      return { code: error.code, status: "unavailable" }
    }
    throw error
  }
}

export const checkReadiness = async (probes: ReadinessProbes): Promise<ReadinessReport> => {
  const [postgres, rustfs] = await Promise.all([
    checkDependency(probes.postgres),
    checkDependency(probes.rustfs),
  ])
  const ready = postgres.status === "ready" && rustfs.status === "ready"

  return {
    configuration: { status: "ready" },
    dependencies: { postgres, rustfs },
    status: ready ? "ready" : "not_ready",
  }
}

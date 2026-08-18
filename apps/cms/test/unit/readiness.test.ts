import { describe, expect, it } from "vitest"

import { checkReadiness } from "../../src/readiness/check-readiness"
import { parseCmsEnvironment } from "../../src/config/environment"
import { createPostgresProbe } from "../../src/readiness/probes"
import { configurationFailureReport } from "../../src/readiness/runtime-readiness"
import { DEPENDENCY_CODES, DependencyProbeError } from "../../src/readiness/types"

const readyProbe = async (): Promise<void> => {}

describe("CMS readiness", () => {
  it("Given available PostgreSQL and RustFS, when checked, then readiness is ready", async () => {
    const report = await checkReadiness({ postgres: readyProbe, rustfs: readyProbe })

    expect(report).toEqual({
      configuration: { status: "ready" },
      dependencies: {
        postgres: { status: "ready" },
        rustfs: { status: "ready" },
      },
      status: "ready",
    })
  })

  it("Given unavailable PostgreSQL, when checked, then readiness reports only PostgreSQL failure", async () => {
    const postgres = async (): Promise<void> => {
      throw new DependencyProbeError("postgres", DEPENDENCY_CODES.POSTGRES_UNAVAILABLE)
    }

    const report = await checkReadiness({ postgres, rustfs: readyProbe })

    expect(report.status).toBe("not_ready")
    expect(report.dependencies).toEqual({
      postgres: { code: "POSTGRES_UNAVAILABLE", status: "unavailable" },
      rustfs: { status: "ready" },
    })
  })

  it("Given an unreachable PostgreSQL endpoint, when probed, then cleanup preserves the typed failure", async () => {
    const environment = parseCmsEnvironment({ GEO_FOUNDRY_CMS_CONFIG_MODE: "build" })

    const report = await checkReadiness({
      postgres: createPostgresProbe(environment),
      rustfs: readyProbe,
    })

    expect(report.dependencies.postgres).toEqual({
      code: "POSTGRES_UNAVAILABLE",
      status: "unavailable",
    })
  })

  it("Given unavailable RustFS, when checked, then readiness reports only RustFS failure", async () => {
    const rustfs = async (): Promise<void> => {
      throw new DependencyProbeError("rustfs", DEPENDENCY_CODES.RUSTFS_UNAVAILABLE)
    }

    const report = await checkReadiness({ postgres: readyProbe, rustfs })

    expect(report.status).toBe("not_ready")
    expect(report.dependencies).toEqual({
      postgres: { status: "ready" },
      rustfs: { code: "RUSTFS_UNAVAILABLE", status: "unavailable" },
    })
  })

  it("Given missing dependency config, when reported, then checks are skipped without values", () => {
    const report = configurationFailureReport([
      "GEO_FOUNDRY_PG_PASSWORD",
      "GEO_FOUNDRY_S3_SECRET_KEY",
    ])

    expect(report).toEqual({
      configuration: {
        code: "CMS_CONFIG_INVALID",
        status: "misconfigured",
        variables: ["GEO_FOUNDRY_PG_PASSWORD", "GEO_FOUNDRY_S3_SECRET_KEY"],
      },
      dependencies: {
        postgres: { code: "POSTGRES_CONFIG_INVALID", status: "misconfigured" },
        rustfs: { code: "RUSTFS_CONFIG_INVALID", status: "misconfigured" },
      },
      status: "not_ready",
    })
  })
})

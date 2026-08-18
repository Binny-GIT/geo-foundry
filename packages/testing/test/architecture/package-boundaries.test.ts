import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  PACKAGE_BOUNDARY_VIOLATION_CODE,
  validateWorkspacePackages,
} from "../../src/architecture/index.js"

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url))

describe("工作区包边界", () => {
  it("验证全部计划包的 ESM 清单、平台纯净性与依赖图", async () => {
    // Given
    const options = {
      requireBuiltExports: false,
      workspaceRoot,
    }

    // When
    const report = await validateWorkspacePackages(options)

    // Then
    expect(report.packages).toEqual([
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
    ])
    expect(report.violations).toEqual([])
  })

  it("拒绝 serving-plane 到 control-plane 导入", async () => {
    // Given
    const fixtureRoot = join(import.meta.dirname, "../fixtures/architecture/serving-violation")

    // When
    const report = await validateWorkspacePackages({
      requireBuiltExports: false,
      requirePlannedPackages: false,
      workspaceRoot: fixtureRoot,
    })

    // Then
    expect(report.violations).toContainEqual({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.SERVING_IMPORTS_CONTROL_PLANE,
      file: "packages/runtime/src/index.ts",
      message: "Serving Plane packages cannot import Control Plane packages",
      packageName: "@geo/runtime",
      specifier: "@geo/compiler",
    })
  })

  it("拒绝 runtime 导入 compiler、CMS、quality、AI、DB 或队列包", async () => {
    // Given
    const fixtureRoot = join(import.meta.dirname, "../fixtures/architecture/serving-violation")

    // When
    const report = await validateWorkspacePackages({
      requireBuiltExports: false,
      requirePlannedPackages: false,
      workspaceRoot: fixtureRoot,
    })

    // Then
    expect(report.violations).toContainEqual({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.RUNTIME_FORBIDDEN_IMPORT,
      file: "packages/runtime/src/index.ts",
      message: "Runtime cannot import compiler, CMS, quality, AI, database, or queue packages",
      packageName: "@geo/runtime",
      specifier: "@geo/compiler",
    })
  })

  it("拒绝未声明的包深层子路径", async () => {
    // Given
    const fixtureRoot = join(import.meta.dirname, "../fixtures/architecture/serving-violation")

    // When
    const report = await validateWorkspacePackages({
      requireBuiltExports: false,
      requirePlannedPackages: false,
      workspaceRoot: fixtureRoot,
    })

    // Then
    expect(report.violations).toContainEqual({
      code: PACKAGE_BOUNDARY_VIOLATION_CODE.PACKAGE_PATH_NOT_EXPORTED,
      file: "packages/runtime/src/index.ts",
      message: "Workspace imports must use a declared package export",
      packageName: "@geo/runtime",
      specifier: "@geo/schema/src/internal.js",
    })
  })
})

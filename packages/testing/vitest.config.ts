import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

import { configuredTestSeed, vitestCacheDirectory } from "./src/vitest-runtime.js"

const readEnvironment = (name: string): string | undefined => process.env[name]
const evidenceDirectory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR")
const reportKind = readEnvironment("GEO_FOUNDRY_REPORT_KIND")
const outputFile =
  evidenceDirectory === undefined || reportKind === undefined
    ? undefined
    : {
        json: resolve(
          evidenceDirectory,
          reportKind === "unit" ? "test-results.json" : `${reportKind}-results.json`,
        ),
        junit: resolve(
          evidenceDirectory,
          reportKind === "unit" ? "junit.xml" : `${reportKind}.junit.xml`,
        ),
      }

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "testing" }),
  test: {
    coverage: {
      include: ["src/determinism.ts", "src/evidence/**/*.ts", "src/shared-services.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory:
        evidenceDirectory === undefined ? "coverage" : resolve(evidenceDirectory, "coverage"),
    },
    exclude: ["**/node_modules/**", "test/fixtures/**"],
    include: ["test/**/*.test.ts"],
    ...(outputFile === undefined ? {} : { outputFile }),
    reporters: outputFile === undefined ? ["default"] : ["default", "junit", "json"],
    sequence: {
      seed: configuredTestSeed(),
      shuffle: {
        files: true,
        tests: true,
      },
    },
    setupFiles: ["./src/setup.ts"],
  },
})

export default config

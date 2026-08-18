import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

import { configuredTestSeed, vitestCacheDirectory } from "./src/vitest-runtime.js"

const readEnvironment = (name: string): string | undefined => process.env[name]
const evidenceDirectory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR") ?? "coverage/failure"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "testing-failure" }),
  test: {
    include: ["test/fixtures/intentional-failure.test.ts"],
    outputFile: {
      json: resolve(evidenceDirectory, "intentional-failure.json"),
      junit: resolve(evidenceDirectory, "intentional-failure.junit.xml"),
    },
    reporters: ["default", "junit", "json"],
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

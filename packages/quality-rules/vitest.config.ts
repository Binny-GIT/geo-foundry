import { defineConfig } from "vitest/config"

import {
  configuredTestSeed,
  vitestCacheDirectory,
} from "../../packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "quality-rules" }),
  test: {
    coverage: {
      include: ["src/deterministic/**/*.ts", "src/semantic/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    sequence: { seed: configuredTestSeed() },
    setupFiles: ["../testing/src/setup.ts"],
  },
})

export default config

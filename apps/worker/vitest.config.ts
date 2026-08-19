import { defineConfig } from "vitest/config"

import {
  configuredTestSeed,
  vitestCacheDirectory,
} from "../../packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "worker" }),
  test: {
    hookTimeout: 60_000,
    sequence: { seed: configuredTestSeed() },
    testTimeout: 90_000,
    setupFiles: ["../../packages/testing/src/setup.ts"],
  },
})

export default config

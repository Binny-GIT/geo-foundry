import { defineConfig } from "vitest/config"

import { configuredTestSeed, vitestCacheDirectory } from "../../packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "delivery" }),
  test: {
    hookTimeout: 60_000,
    sequence: { seed: configuredTestSeed() },
    setupFiles: ["../../packages/testing/src/setup.ts"],
    testTimeout: 60_000,
  },
})

export default config

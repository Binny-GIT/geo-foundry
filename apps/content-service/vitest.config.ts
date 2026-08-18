import { defineConfig } from "vitest/config"

import {
  configuredTestSeed,
  vitestCacheDirectory,
} from "../../packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "content-service" }),
  test: {
    sequence: { seed: configuredTestSeed() },
    setupFiles: ["../../packages/testing/src/setup.ts"],
  },
})

export default config

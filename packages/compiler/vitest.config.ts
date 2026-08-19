import { defineConfig } from "vitest/config"

import {
  configuredTestSeed,
  vitestCacheDirectory,
} from "../../packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "compiler" }),
  test: { sequence: { seed: configuredTestSeed() }, setupFiles: ["../testing/src/setup.ts"] },
})

export default config

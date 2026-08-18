import { defineConfig } from "vitest/config"

import { configuredTestSeed, vitestCacheDirectory } from "./packages/testing/src/vitest-runtime.js"

export const config = defineConfig({
  cacheDir: vitestCacheDirectory({ packageName: "workspace" }),
  test: {
    projects: [
      "apps/cms/vitest.config.ts",
      "packages/content-client/vitest.config.ts",
      "packages/domain/vitest.config.ts",
      "packages/publisher/vitest.config.ts",
      "packages/schema/vitest.config.ts",
      "packages/testing/vitest.config.ts",
    ],
    sequence: {
      seed: configuredTestSeed(),
      shuffle: {
        files: true,
        tests: true,
      },
    },
  },
})

export default config

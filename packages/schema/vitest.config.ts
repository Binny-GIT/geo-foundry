import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const readEnvironment = (name: string): string | undefined => process.env[name]
const seed = Number(readEnvironment("GEO_FOUNDRY_TEST_SEED") ?? "260817")
const cacheRoot = readEnvironment("GEO_FOUNDRY_VITEST_CACHE_DIR")

export const config = defineConfig({
  cacheDir:
    cacheRoot === undefined
      ? resolve(tmpdir(), "geo-foundry-vitest-cache", `schema-${process.pid}`)
      : resolve(cacheRoot, "schema"),
  test: {
    coverage: {
      include: ["src/release/v1/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/release-v1",
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    sequence: { seed },
    setupFiles: ["../testing/src/setup.ts"],
  },
})

export default config

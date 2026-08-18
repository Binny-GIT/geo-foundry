import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { defineConfig } from "vitest/config"

const cacheRoot = process.env["GEO_FOUNDRY_VITEST_CACHE_DIR"]

export const config = defineConfig({
  cacheDir:
    cacheRoot === undefined
      ? resolve(tmpdir(), "geo-foundry-vitest-cache", `content-client-${process.pid}`)
      : resolve(cacheRoot, "content-client"),
  test: {
    sequence: {
      seed: Number(process.env["GEO_FOUNDRY_TEST_SEED"] ?? "260818"),
    },
  },
})

export default config

import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { parseTestSeed } from "./determinism.js"

export type VitestRuntimeOptions = {
  readonly packageName: string
}

export const readTestEnvironment = (name: string): string | undefined => process.env[name]

export const configuredTestSeed = (): number =>
  parseTestSeed(readTestEnvironment("GEO_FOUNDRY_TEST_SEED"))

export const vitestCacheDirectory = (options: VitestRuntimeOptions): string => {
  const activeCacheDirectory = readTestEnvironment("GEO_FOUNDRY_VITEST_CACHE_DIR")
  return activeCacheDirectory === undefined
    ? resolve(tmpdir(), "geo-foundry-vitest-cache", `${options.packageName}-${process.pid}`)
    : resolve(activeCacheDirectory, options.packageName)
}

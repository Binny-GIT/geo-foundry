import { defineConfig } from "vitest/config"

export const config = defineConfig({
  test: { environment: "node", setupFiles: ["../../packages/testing/src/setup.ts"] },
})

export default config

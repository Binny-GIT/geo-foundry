import { defineConfig } from "vitest/config"

export const config = defineConfig({
  test: { setupFiles: ["../testing/src/setup.ts"] },
})

export default config

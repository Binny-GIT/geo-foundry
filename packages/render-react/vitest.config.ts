import { defineConfig } from "vitest/config"

export const config = defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["../testing/src/setup.ts"],
  },
})

export default config

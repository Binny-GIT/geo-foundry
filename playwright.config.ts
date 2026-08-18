import { resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const readEnvironment = (name: string): string | undefined => process.env[name]
const evidenceDirectory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR") ?? ".omo/evidence/task-7"

export const config = defineConfig({
  forbidOnly: true,
  outputDir: resolve(evidenceDirectory, "playwright-artifacts"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  reporter: [
    ["junit", { outputFile: resolve(evidenceDirectory, "playwright.junit.xml") }],
    ["json", { outputFile: resolve(evidenceDirectory, "playwright-results.json") }],
  ],
  retries: 1,
  testDir: "tests/e2e",
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
})

export default config

import { resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const readEnvironment = (name: string): string | undefined => process.env[name]
const evidenceDirectory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR") ?? "temp/e2e"
const hostResolverRules =
  "MAP site-a.test 127.0.0.1,MAP www.site-a.test 127.0.0.1,MAP site-b.test 127.0.0.1,MAP www.site-b.test 127.0.0.1,EXCLUDE localhost"

export const config = defineConfig({
  forbidOnly: true,
  globalSetup: "./tests/e2e/global-setup.mjs",
  outputDir: resolve(evidenceDirectory, "playwright-artifacts"),
  projects: [
    {
      name: "site-a-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: [`--host-resolver-rules=${hostResolverRules}`] },
      },
    },
    {
      name: "site-a-mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: { args: [`--host-resolver-rules=${hostResolverRules}`] },
      },
    },
    {
      name: "site-b-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: [`--host-resolver-rules=${hostResolverRules}`] },
      },
    },
    {
      name: "site-b-mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: { args: [`--host-resolver-rules=${hostResolverRules}`] },
      },
    },
  ],
  reporter: [
    ["html", { open: "never", outputFolder: resolve(evidenceDirectory, "playwright-report") }],
    ["junit", { outputFile: resolve(evidenceDirectory, "playwright.junit.xml") }],
    ["json", { outputFile: resolve(evidenceDirectory, "playwright-results.json") }],
  ],
  retries: 1,
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  use: {
    locale: "en-US",
    screenshot: "only-on-failure",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
})

export default config

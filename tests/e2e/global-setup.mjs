import { setupTwoSiteE2e } from "./support.mjs"

// biome-ignore lint/style/noDefaultExport: Playwright loads global setup as an ESM default export.
export default async function globalSetup() {
  const teardown = await setupTwoSiteE2e()
  return async () => {
    await teardown()
  }
}

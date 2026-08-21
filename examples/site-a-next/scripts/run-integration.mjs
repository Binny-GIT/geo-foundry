if (process.env.GEO_FOUNDRY_SITE_A_INTEGRATION !== "true") {
  process.stdout.write(
    "SITE_A_INTEGRATION_SKIPPED: set GEO_FOUNDRY_SITE_A_INTEGRATION=true to run shared RustFS host verification\n",
  )
  process.exit(0)
}

await import("./site-a-integration.mjs").then(({ runSiteAIntegration }) => runSiteAIntegration())

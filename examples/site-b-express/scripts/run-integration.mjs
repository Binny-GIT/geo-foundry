if (process.env.GEO_FOUNDRY_SITE_B_INTEGRATION !== "true") {
  process.stdout.write(
    "SITE_B_INTEGRATION_SKIPPED: set GEO_FOUNDRY_SITE_B_INTEGRATION=true to run shared RustFS host verification\n",
  )
  process.exit(0)
}

await import("./site-b-integration.mjs").then(({ runSiteBIntegration }) => runSiteBIntegration())

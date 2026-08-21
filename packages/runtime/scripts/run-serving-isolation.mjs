if (process.env.GEO_FOUNDRY_SERVING_ISOLATION !== "true") {
  process.stdout.write("SERVING_ISOLATION_SKIPPED: set GEO_FOUNDRY_SERVING_ISOLATION=true to run shared RustFS isolation\n")
  process.exit(0)
}

const { runServingIsolation } = await import("./serving-isolation.mjs")
const result = await runServingIsolation()
process.stdout.write(`${JSON.stringify({ runId: result.runId, servingIsolation: "passed" })}\n`)

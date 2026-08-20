import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"

const integrationEnvironment = {
  ...process.env,
  GEO_FOUNDRY_CMS_CONFIG_MODE: "integration-test",
}

const runCommand = async (argumentsList) => {
  const child = spawn(process.execPath, argumentsList, {
    env: integrationEnvironment,
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    process.exitCode = exitCode
    return false
  }
  return true
}

const run = async () => {
  if (
    !(await runCommand([
      "scripts/secure-run.mjs",
      "node",
      "scripts/reset-integration-database.mjs",
    ]))
  ) {
    return
  }
  if (!(await runCommand(["scripts/run-migrations.mjs"]))) {
    return
  }
  if (!(await runCommand(["scripts/run-migrations.mjs"]))) {
    return
  }
  const testFiles = (await readdir("test/integration"))
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
  for (const testFile of testFiles) {
    if (
      !(await runCommand([
        "scripts/secure-run.mjs",
        "vitest",
        "run",
        "--configLoader",
        "runner",
        `test/integration/${testFile}`,
        "--no-file-parallelism",
      ]))
    ) {
      return
    }
  }
}

run().catch(() => {
  process.stderr.write('{"code":"CMS_INTEGRATION_RUNNER_FAILED"}\n')
  process.exitCode = 1
})

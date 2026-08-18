import { spawn } from "node:child_process"

const runCommand = async (argumentsList) => {
  const child = spawn(process.execPath, argumentsList, {
    env: process.env,
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
  if (!(await runCommand(["scripts/run-migrations.mjs"]))) {
    return
  }
  if (!(await runCommand(["scripts/run-migrations.mjs"]))) {
    return
  }
  await runCommand([
    "scripts/secure-run.mjs",
    "vitest",
    "run",
    "--configLoader",
    "runner",
    "test/integration",
    "--no-file-parallelism",
  ])
}

run().catch(() => {
  process.stderr.write('{"code":"CMS_INTEGRATION_RUNNER_FAILED"}\n')
  process.exitCode = 1
})

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"

const run = async () => {
  const migrationIndex = await readFile(
    new URL("../src/migrations/index.ts", import.meta.url),
    "utf8",
  )
  if (!migrationIndex.includes("name:")) {
    process.stderr.write('{"code":"CMS_CHECKED_IN_MIGRATION_MISSING"}\n')
    process.exitCode = 1
    return
  }

  const child = spawn(process.execPath, ["scripts/secure-run.mjs", "payload", "migrate"], {
    env: process.env,
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  process.exitCode = exitCode
}

run().catch(() => {
  process.stderr.write('{"code":"CMS_MIGRATION_RUNNER_FAILED"}\n')
  process.exitCode = 1
})

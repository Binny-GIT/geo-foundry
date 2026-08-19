import { spawn } from "node:child_process"

const child = spawn(
  process.execPath,
  [
    "../../apps/cms/scripts/secure-run.mjs",
    "vitest",
    "run",
    "--configLoader",
    "runner",
    "test/integration",
    "--no-file-parallelism",
  ],
  { cwd: process.cwd(), env: process.env, stdio: "inherit" },
)
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code) => resolve(code ?? 1))
})
process.exitCode = exitCode

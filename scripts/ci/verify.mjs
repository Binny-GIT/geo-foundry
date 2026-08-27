import { spawn } from "node:child_process"
import { resolve } from "node:path"

import { scanTrackedFiles } from "./repository-safety.mjs"

const root = resolve(import.meta.dirname, "../..")

const run = async (command, argumentsList) => {
  const child = spawn(command, argumentsList, {
    cwd: root,
    env: { ...process.env, TURBO_REMOTE_CACHE: "0" },
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`CI_VERIFY_COMMAND_FAILED:${command}:${argumentsList.join(" ")}`)
  }
}

const main = async () => {
  scanTrackedFiles()
  await run("pnpm", ["verify:toolchain"])
  await run("pnpm", ["test:ci-contracts"])
  await run("node", ["--test", "tooling/documentation-contract.test.mjs"])
  await run("node", ["scripts/ci/format-changed.mjs"])
  await run("node", ["scripts/ci/lint-changed.mjs"])
  await run("pnpm", ["build:fresh"])
  await run("pnpm", ["typecheck"])
  await run("pnpm", ["test:fresh"])
  await run("pnpm", ["test:faults:contracts"])
  await run("pnpm", ["--filter", "@geo/compiler", "test:determinism"])
  await run("pnpm", ["--filter", "@geo/compiler", "test:determinism"])
  await run("pnpm", [
    "--filter",
    "@geo/publisher",
    "exec",
    "vitest",
    "run",
    "--configLoader",
    "runner",
    "test/rollback.test.ts",
  ])
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ code: error instanceof Error ? error.message : "CI_VERIFY_FAILED" })}\n`,
  )
  process.exitCode = 1
})

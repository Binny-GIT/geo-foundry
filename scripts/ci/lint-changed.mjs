import { execFileSync, spawn } from "node:child_process"
import { extname } from "node:path"

const base = process.env.GEO_FOUNDRY_CI_BASE_SHA
const lintExtensions = new Set([".cjs", ".js", ".json", ".jsonc", ".mjs", ".ts", ".tsx"])
const gitFiles = (argumentsList) =>
  execFileSync("git", argumentsList, { encoding: "utf8" }).split("\n").filter(Boolean)

const changedFiles = () => {
  const files = new Set([
    ...gitFiles(["diff", "--name-only", "--diff-filter=ACMR", "--cached"]),
    ...gitFiles(["diff", "--name-only", "--diff-filter=ACMR"]),
    ...(base === undefined || base.length === 0
      ? []
      : gitFiles(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])),
  ])
  return [...files].filter((path) => lintExtensions.has(extname(path))).sort()
}

const main = async () => {
  const files = changedFiles()
  if (files.length === 0) {
    return
  }
  const child = spawn("pnpm", ["exec", "biome", "lint", ...files], { stdio: "inherit" })
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ code: error instanceof Error ? error.message : "CI_LINT_FAILED" })}\n`,
  )
  process.exitCode = 1
})

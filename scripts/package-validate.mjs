import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { validateWorkspacePackages } from "../packages/testing/dist/architecture/index.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const workspaceArgumentIndex = process.argv.indexOf("--workspace")
const reportArgumentIndex = process.argv.indexOf("--report")
const workspaceRoot =
  workspaceArgumentIndex === -1 ? repositoryRoot : process.argv[workspaceArgumentIndex + 1]

if (workspaceRoot === undefined) {
  throw new TypeError("--workspace requires a path")
}

const report = await validateWorkspacePackages({
  requireBuiltExports: !process.argv.includes("--skip-built"),
  requirePlannedPackages: !process.argv.includes("--allow-partial"),
  workspaceRoot,
})
const serializedReport = `${JSON.stringify(report, null, 2)}\n`

if (reportArgumentIndex !== -1) {
  const reportPath = process.argv[reportArgumentIndex + 1]
  if (reportPath === undefined) {
    throw new TypeError("--report requires a path")
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, serializedReport)
}

process.stdout.write(serializedReport)
if (report.violations.length > 0) {
  process.exitCode = 1
}

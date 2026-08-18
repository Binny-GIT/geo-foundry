import { runEvidenceCommand } from "./bootstrap.mjs"

process.exitCode = await runEvidenceCommand("run", process.argv.slice(2))

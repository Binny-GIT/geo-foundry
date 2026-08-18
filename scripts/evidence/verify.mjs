import { runEvidenceCommand } from "./bootstrap.mjs"

process.exitCode = await runEvidenceCommand("verify", process.argv.slice(2))

import { spawn } from "node:child_process"

const migrationNamePattern = /^[a-z0-9][a-z0-9-]{2,63}$/

const run = async () => {
  if (process.env.CI === "true" || process.env.NODE_ENV === "production") {
    process.stderr.write('{"code":"CMS_MIGRATION_GENERATION_FORBIDDEN"}\n')
    process.exitCode = 1
    return
  }

  const rawArguments = process.argv.slice(2)
  const argumentsList = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments
  const migrationName = argumentsList[0] ?? "task9-bootstrap"
  if (argumentsList.length > 1 || !migrationNamePattern.test(migrationName)) {
    process.stderr.write('{"code":"CMS_MIGRATION_NAME_INVALID"}\n')
    process.exitCode = 1
    return
  }

  const child = spawn("payload", ["migrate:create", migrationName], {
    env: {
      ...process.env,
      GEO_FOUNDRY_CMS_CONFIG_MODE: "build",
    },
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  process.exitCode = exitCode
}

run().catch(() => {
  process.stderr.write('{"code":"CMS_MIGRATION_GENERATION_FAILED"}\n')
  process.exitCode = 1
})

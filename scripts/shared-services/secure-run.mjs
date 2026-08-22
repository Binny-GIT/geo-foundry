import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"

import { writeSafeFailure } from "./cli.mjs"
import { SharedServicesError } from "./resources.mjs"

const requiredCredentialFileVariables = [
  ["GEO_FOUNDRY_S3_ACCESS_KEY_FILE", "GEO_FOUNDRY_S3_ACCESS_KEY"],
  ["GEO_FOUNDRY_S3_SECRET_KEY_FILE", "GEO_FOUNDRY_S3_SECRET_KEY"],
]

const optionalCredentialFileVariables = [
  ["GEO_FOUNDRY_PG_USER_FILE", "GEO_FOUNDRY_PG_USER"],
  ["GEO_FOUNDRY_PG_PASSWORD_FILE", "GEO_FOUNDRY_PG_PASSWORD"],
  ["GEO_FOUNDRY_REDIS_USERNAME_FILE", "GEO_FOUNDRY_REDIS_USERNAME"],
  ["GEO_FOUNDRY_REDIS_PASSWORD_FILE", "GEO_FOUNDRY_REDIS_PASSWORD"],
]

const requireCredentialFilePath = (variable) => {
  const path = process.env[variable]
  if (path === undefined || path.trim().length === 0) {
    return undefined
  }
  return path
}

const readCredential = async (path) => {
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    throw new SharedServicesError(
      "SHARED_SERVICE_CREDENTIAL_FILE_INSECURE",
      "Use a credential file owned by the current user with mode 0600.",
    )
  }
  return (await readFile(path, "utf8")).trim()
}

const run = async () => {
  const [action, ...argumentsList] = process.argv.slice(2)
  if (action !== "check" && action !== "cleanup") {
    throw new SharedServicesError(
      "SHARED_SERVICE_ARGUMENT_INVALID",
      "Invoke the secure runner through pnpm shared:check or pnpm shared:cleanup.",
    )
  }

  const requiredFiles = requiredCredentialFileVariables.map(([file]) =>
    requireCredentialFilePath(file),
  )
  const missing = requiredCredentialFileVariables
    .filter((_, index) => requiredFiles[index] === undefined)
    .map(([file]) => file)
  if (missing.length > 0) {
    process.stderr.write(
      `${JSON.stringify({
        code: "SHARED_SERVICE_ENV_MISSING",
        variables: missing,
        remediation: "Provide the approved rustfs-geo-foundry-svc credential file references.",
      })}\n`,
    )
    process.exitCode = 1
    return
  }

  const injectedCredentials = Object.fromEntries(
    await Promise.all(
      requiredCredentialFileVariables.map(async ([_file, variable], index) => [
        variable,
        await readCredential(requiredFiles[index]),
      ]),
    ),
  )
  for (const [file, variable] of optionalCredentialFileVariables) {
    const path = requireCredentialFilePath(file)
    if (path !== undefined) {
      injectedCredentials[variable] = await readCredential(path)
    }
  }
  const childEnvironment = { ...process.env }
  for (const variable of [
    "GEO_FOUNDRY_PG_USER",
    "GEO_FOUNDRY_PG_PASSWORD",
    "GEO_FOUNDRY_REDIS_USERNAME",
    "GEO_FOUNDRY_REDIS_PASSWORD",
    "GEO_FOUNDRY_S3_ACCESS_KEY",
    "GEO_FOUNDRY_S3_SECRET_KEY",
  ]) {
    delete childEnvironment[variable]
  }
  const script = new URL(`${action}.mjs`, import.meta.url)
  const child = spawn(process.execPath, [script.pathname, ...argumentsList], {
    env: {
      ...childEnvironment,
      ...injectedCredentials,
      GEO_FOUNDRY_S3_SECRET_REF: "rustfs-geo-foundry-svc",
    },
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  process.exitCode = exitCode
}

// no-excuse-ok: catch
run().catch((error) => {
  writeSafeFailure(error)
  process.exitCode = 1
})

import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"

const credentialFiles = [
  ["GEO_FOUNDRY_PG_USER_FILE", "GEO_FOUNDRY_PG_USER"],
  ["GEO_FOUNDRY_PG_PASSWORD_FILE", "GEO_FOUNDRY_PG_PASSWORD"],
  ["GEO_FOUNDRY_S3_ACCESS_KEY_FILE", "GEO_FOUNDRY_S3_ACCESS_KEY"],
  ["GEO_FOUNDRY_S3_SECRET_KEY_FILE", "GEO_FOUNDRY_S3_SECRET_KEY"],
  ["GEO_FOUNDRY_CMS_SECRET_FILE", "PAYLOAD_SECRET"],
]

const optionalCredentialFiles = [
  ["GEO_FOUNDRY_REDIS_PASSWORD_FILE", "GEO_FOUNDRY_REDIS_PASSWORD"],
  ["GEO_FOUNDRY_REDIS_USERNAME_FILE", "GEO_FOUNDRY_REDIS_USERNAME"],
]

class SecureRunError extends Error {
  constructor(code, variables = []) {
    super(code)
    this.name = "SecureRunError"
    this.variables = variables
  }
}

const readCredential = async (fileVariable) => {
  const path = process.env[fileVariable]
  if (path === undefined || path.trim().length === 0) {
    throw new SecureRunError("CMS_CREDENTIAL_FILE_MISSING", [fileVariable])
  }
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    throw new SecureRunError("CMS_CREDENTIAL_FILE_INSECURE", [fileVariable])
  }
  const credential = (await readFile(path, "utf8")).trim()
  if (credential.length === 0) {
    throw new SecureRunError("CMS_CREDENTIAL_FILE_EMPTY", [fileVariable])
  }
  return credential
}

const permittedCommand = (argumentsList) => {
  const [binary, action] = argumentsList
  return (
    (binary === "next" && (action === "dev" || action === "start")) ||
    (binary === "node" &&
      (action === "scripts/reset-integration-database.mjs" || action === "scripts/mvp-seed.mjs")) ||
    (binary === "payload" && (action === "migrate" || action === "migrate:status")) ||
    (binary === "vitest" && action === "run")
  )
}

const run = async () => {
  const argumentsList = process.argv.slice(2)
  if (!permittedCommand(argumentsList)) {
    throw new SecureRunError("CMS_COMMAND_NOT_PERMITTED")
  }

  const credentials = await Promise.all(credentialFiles.map(([file]) => readCredential(file)))
  const injectedEnvironment = { ...process.env }
  credentialFiles.forEach(([, variable], index) => {
    injectedEnvironment[variable] = credentials[index]
  })
  for (const [file, variable] of optionalCredentialFiles) {
    if (process.env[file] !== undefined && process.env[file].trim().length > 0) {
      injectedEnvironment[variable] = await readCredential(file)
    }
  }
  injectedEnvironment.GEO_FOUNDRY_PG_SECRET_REF = "pg-server-mk-dev-existing-auth"
  injectedEnvironment.GEO_FOUNDRY_S3_SECRET_REF = "rustfs-geo-foundry-svc"

  const [binary, ...binaryArguments] = argumentsList
  const child = spawn(binary, binaryArguments, {
    env: injectedEnvironment,
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  process.exitCode = exitCode
}

run().catch((error) => {
  const diagnostic =
    error instanceof SecureRunError
      ? { code: error.message, variables: error.variables }
      : { code: "CMS_SECURE_COMMAND_FAILED" }
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`)
  process.exitCode = 1
})

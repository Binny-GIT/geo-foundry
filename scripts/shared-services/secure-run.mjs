import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"

import { writeSafeFailure } from "./cli.mjs"
import { SharedServicesError } from "./resources.mjs"

const credentialFileVariables = ["GEO_FOUNDRY_S3_ACCESS_KEY_FILE", "GEO_FOUNDRY_S3_SECRET_KEY_FILE"]

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

  const [accessKeyFile, secretKeyFile] = credentialFileVariables.map(requireCredentialFilePath)
  const missing = credentialFileVariables.filter((_, index) =>
    index === 0 ? accessKeyFile === undefined : secretKeyFile === undefined,
  )
  if (missing.length > 0 || accessKeyFile === undefined || secretKeyFile === undefined) {
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

  const [accessKey, secretKey] = await Promise.all([
    readCredential(accessKeyFile),
    readCredential(secretKeyFile),
  ])
  const script = new URL(`${action}.mjs`, import.meta.url)
  const child = spawn(process.execPath, [script.pathname, ...argumentsList], {
    env: {
      ...process.env,
      GEO_FOUNDRY_S3_ACCESS_KEY: accessKey,
      GEO_FOUNDRY_S3_SECRET_KEY: secretKey,
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

import { readFileSync, statSync } from "node:fs"

export class WorkerCredentialError extends Error {
  override readonly name = "WorkerCredentialError"

  constructor(readonly code: string) {
    super(code)
  }
}

const strictFileMode = (environment: Record<string, string | undefined>): boolean =>
  environment["GEO_FOUNDRY_CREDENTIAL_MODE"] === "file"

export const readWorkerCredentialFile = (fileVariable: string, path: string): string => {
  let metadata: ReturnType<typeof statSync>
  try {
    metadata = statSync(path)
  } catch {
    throw new WorkerCredentialError(`WORKER_CREDENTIAL_FILE_MISSING:${fileVariable}`)
  }
  const ownerId = process.getuid?.()
  if (ownerId === undefined || metadata.uid !== ownerId || (metadata.mode & 0o077) !== 0) {
    throw new WorkerCredentialError(`WORKER_CREDENTIAL_FILE_INSECURE:${fileVariable}`)
  }
  let credential: string
  try {
    credential = readFileSync(path, "utf8").trim()
  } catch {
    throw new WorkerCredentialError(`WORKER_CREDENTIAL_FILE_MISSING:${fileVariable}`)
  }
  if (credential.length === 0) {
    throw new WorkerCredentialError(`WORKER_CREDENTIAL_FILE_EMPTY:${fileVariable}`)
  }
  return credential
}

export const workerCredentialOf = (
  environment: Record<string, string | undefined>,
  name: string,
): string => {
  const direct = environment[name]?.trim()
  const fileVariable = `${name}_FILE`
  const path = environment[fileVariable]?.trim()
  if (strictFileMode(environment) && direct !== undefined && direct.length > 0) {
    throw new WorkerCredentialError(`WORKER_CREDENTIAL_DIRECT_FORBIDDEN:${name}`)
  }
  if (path !== undefined && path.length > 0) return readWorkerCredentialFile(fileVariable, path)
  if (!strictFileMode(environment) && direct !== undefined && direct.length > 0) return direct
  return "unset"
}

export const optionalWorkerCredential = (
  environment: Record<string, string | undefined>,
  name: string,
): string | undefined => {
  const credential = workerCredentialOf(environment, name)
  return credential === "unset" ? undefined : credential
}

import { randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const runIdPattern = /^todo39-[a-z0-9]{12,32}$/

export const createFaultRunId = () => `todo39-${randomUUID().replaceAll("-", "").slice(0, 20)}`

export const assertFaultRunId = (runId) => {
  if (!runIdPattern.test(runId)) {
    throw new Error("FAULT_RUN_ID_INVALID")
  }
  return runId
}

export const faultEvidenceDirectoryOf = async (workspaceRoot) => {
  const configured =
    process.env.GEO_FOUNDRY_FAULT_EVIDENCE_DIR ??
    process.env.GEO_FOUNDRY_EVIDENCE_DIR ??
    resolve(workspaceRoot, ".omo/evidence/task-39-geo-foundry-development-plan")
  const directory = resolve(configured)
  const forbidden = [
    workspaceRoot,
    resolve(workspaceRoot, ".zcode"),
    resolve(workspaceRoot, ".git"),
  ]
  if (forbidden.some((path) => directory === path || directory.startsWith(`${path}/`))) {
    throw new Error("FAULT_EVIDENCE_DIRECTORY_FORBIDDEN")
  }
  await mkdir(directory, { mode: 0o700, recursive: true })
  return directory
}

export const secureFile = async (name) => {
  const path = process.env[name]
  if (path === undefined || path.trim().length === 0) {
    throw new Error(`FAULT_ENV_REQUIRED:${name}`)
  }
  const metadata = await stat(path)
  if (metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`FAULT_CREDENTIAL_FILE_INSECURE:${name}`)
  }
  const value = (await readFile(path, "utf8")).trim()
  if (value.length === 0) {
    throw new Error(`FAULT_CREDENTIAL_FILE_EMPTY:${name}`)
  }
  return { path, value }
}

export const assertLoopbackEndpoint = () => {
  if (process.env.GEO_FOUNDRY_S3_ENDPOINT !== "127.0.0.1") {
    throw new Error("FAULT_S3_LOOPBACK_REQUIRED")
  }
  const port = Number(process.env.GEO_FOUNDRY_S3_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FAULT_S3_PORT_INVALID")
  }
  return port
}

export const assertLoopbackRedisEndpoint = () => {
  const host = process.env.GEO_FOUNDRY_REDIS_HOST ?? "127.0.0.1"
  const port = Number(process.env.GEO_FOUNDRY_REDIS_PORT ?? "6379")
  if (host !== "127.0.0.1") {
    throw new Error("FAULT_REDIS_LOOPBACK_REQUIRED")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FAULT_REDIS_PORT_INVALID")
  }
  return { host, port }
}

export const ownedPhysicalKey = (keyPrefix, logicalKey) => {
  const prefix = `${keyPrefix}/`
  if (!logicalKey.startsWith("sites/") && !logicalKey.startsWith("routing/")) {
    throw new Error("FAULT_LOGICAL_KEY_FORBIDDEN")
  }
  const physicalKey = `${keyPrefix}/${logicalKey}`
  if (!physicalKey.startsWith(prefix) || physicalKey.includes("../")) {
    throw new Error("FAULT_FOREIGN_OBJECT_ACCESS")
  }
  return physicalKey
}

export const writeFaultEvidence = async (directory, relativePath, value) => {
  const target = resolve(directory, relativePath)
  if (!target.startsWith(`${resolve(directory)}/`)) {
    throw new Error("FAULT_EVIDENCE_PATH_FORBIDDEN")
  }
  await mkdir(resolve(target, ".."), { mode: 0o700, recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export const faultCase = (input) => {
  if (input.status !== "recovered" && input.status !== "passed") {
    throw new Error("FAULT_CASE_STATUS_INVALID")
  }
  return Object.freeze({
    assertions: [...input.assertions],
    fault: input.fault,
    id: input.id,
    recovery: input.recovery,
    status: input.status,
  })
}

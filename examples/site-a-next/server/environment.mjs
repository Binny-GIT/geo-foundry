import { readFileSync } from "node:fs"

const required = (environment, name) => {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`SITE_A_ENV_REQUIRED:${name}`)
  }
  return value.trim()
}

const secretFromFile = (environment, name) => {
  const value = readFileSync(required(environment, name), "utf8").trim()
  if (value.length === 0) {
    throw new Error(`SITE_A_SECRET_FILE_EMPTY:${name}`)
  }
  return value
}

const timeoutOf = (value) => {
  if (!/^\d+$/.test(value)) {
    throw new Error("SITE_A_TIMEOUT_INVALID")
  }
  const timeoutMs = Number(value)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("SITE_A_TIMEOUT_INVALID")
  }
  return timeoutMs
}

export const siteAEnvironmentOf = (environment = process.env) => {
  const endpoint = required(environment, "GEO_FOUNDRY_SITE_A_S3_ENDPOINT")
  try {
    new URL(endpoint)
  } catch {
    throw new Error("SITE_A_ENDPOINT_INVALID")
  }
  return Object.freeze({
    accessKey: secretFromFile(environment, "GEO_FOUNDRY_SITE_A_S3_ACCESS_KEY_FILE"),
    bucket: required(environment, "GEO_FOUNDRY_SITE_A_S3_BUCKET"),
    endpoint,
    keyPrefix: required(environment, "GEO_FOUNDRY_SITE_A_S3_KEY_PREFIX").replace(/\/+$/, ""),
    secretKey: secretFromFile(environment, "GEO_FOUNDRY_SITE_A_S3_SECRET_KEY_FILE"),
    timeoutMs: timeoutOf(environment.GEO_FOUNDRY_SITE_A_S3_TIMEOUT_MS ?? "3000"),
  })
}

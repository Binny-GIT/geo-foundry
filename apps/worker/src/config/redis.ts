import { readFileSync } from "node:fs"

export type WorkerRedisOptions = {
  readonly db: number
  readonly host: string
  readonly password?: string
  readonly port: number
  readonly username?: string
}

const optionalValue = (
  direct: string | undefined,
  file: string | undefined,
): string | undefined => {
  if (direct !== undefined && direct.length > 0) {
    return direct
  }
  if (file !== undefined && file.length > 0) {
    return readFileSync(file, "utf8").trim()
  }
  return undefined
}

/**
 * Shared-service Redis connection for the worker. Values come from the
 * approved credential injection (direct or mode-0600 file), never from the
 * repository; connection-level configuration only - the worker never reads
 * or mutates server-wide settings such as AOF or eviction policy.
 */
export const parseWorkerRedisOptions = (
  env: Record<string, string | undefined>,
): WorkerRedisOptions => {
  const password = optionalValue(
    env["GEO_FOUNDRY_REDIS_PASSWORD"],
    env["GEO_FOUNDRY_REDIS_PASSWORD_FILE"],
  )
  const username = optionalValue(
    env["GEO_FOUNDRY_REDIS_USERNAME"],
    env["GEO_FOUNDRY_REDIS_USERNAME_FILE"],
  )
  return {
    db: Number(env["GEO_FOUNDRY_REDIS_DATABASE"] ?? "0") || 0,
    host: env["GEO_FOUNDRY_REDIS_HOST"] ?? "127.0.0.1",
    ...(password === undefined ? {} : { password }),
    port: Number(env["GEO_FOUNDRY_REDIS_PORT"] ?? "6379") || 6379,
    ...(username === undefined ? {} : { username }),
  }
}

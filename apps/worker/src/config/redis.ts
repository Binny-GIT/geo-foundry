import { optionalWorkerCredential } from "./credentials.js"

export type WorkerRedisOptions = {
  readonly db: number
  readonly host: string
  readonly password?: string
  readonly port: number
  readonly username?: string
}

/**
 * Shared-service Redis connection for the worker. Credentials come from
 * owner-only files in container runtime and never alter Redis server settings.
 */
export const parseWorkerRedisOptions = (
  env: Record<string, string | undefined>,
): WorkerRedisOptions => {
  const password = optionalWorkerCredential(env, "GEO_FOUNDRY_REDIS_PASSWORD")
  const username = optionalWorkerCredential(env, "GEO_FOUNDRY_REDIS_USERNAME")
  return {
    db: Number(env["GEO_FOUNDRY_REDIS_DATABASE"] ?? "0") || 0,
    host: env["GEO_FOUNDRY_REDIS_HOST"] ?? "127.0.0.1",
    ...(password === undefined ? {} : { password }),
    port: Number(env["GEO_FOUNDRY_REDIS_PORT"] ?? "6379") || 6379,
    ...(username === undefined ? {} : { username }),
  }
}

/* Runtime-only database/config singleton. Import is build-safe: credentials are read lazily on first call. */

import { Pool } from "pg"

import { parseCmsEnvironment } from "../config/environment"
import { createServerDb, type ServerDb } from "./db/client"

export type ServerRuntime = Readonly<{
  configSecret: string
  db: ServerDb
}>

let runtime: ServerRuntime | null = null

export const serverRuntime = (): ServerRuntime => {
  runtime ??= (() => {
    const environment = parseCmsEnvironment(process.env)
    const pool = new Pool({ connectionString: environment.postgres.connectionString, max: 8 })
    return {
      configSecret: environment.payloadSecret,
      db: createServerDb(pool),
    }
  })()
  return runtime
}

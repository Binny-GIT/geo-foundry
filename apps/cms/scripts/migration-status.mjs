/* 列出 drizzle_migrations 账本与 ./drizzle 目录的差异。 */
import { readdir } from "node:fs/promises"

import { sql } from "drizzle-orm"

import { serverRuntime } from "../src/server/runtime.ts"

const runtime = serverRuntime()
const files = (await readdir(new URL("../drizzle", import.meta.url)))
  .filter((name) => name.endsWith(".sql"))
  .sort()
const applied = await runtime.db
  .execute(sql`SELECT id, hash, created_at FROM geo_foundry.drizzle_migrations ORDER BY id`)
  .catch(() => ({ rows: [] }))
process.stdout.write(
  `${JSON.stringify({ applied: applied.rows.length, files: files.length, migrations: files })}\n`,
)
process.exit(0)

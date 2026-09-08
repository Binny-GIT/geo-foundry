/*
 * 运行 ./drizzle 下的 SQL 迁移（drizzle-orm migrator）。账本表
 * geo_foundry.drizzle_migrations 记录已应用的 hash，重复执行幂等。
 * 通过 secure-run 注入的 FILE-only 凭据连接。
 */
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { serverRuntime } from "../src/server/runtime.ts"

const runtime = serverRuntime()
await migrate(runtime.db, {
  migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  migrationsSchema: "geo_foundry",
  migrationsTable: "drizzle_migrations",
})
process.stdout.write('{"code":"CMS_MIGRATIONS_APPLIED"}\n')
process.exit(0)

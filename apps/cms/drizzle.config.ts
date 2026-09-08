/*
 * drizzle-kit 只用于生成/校验 SQL 迁移；运行时迁移由 scripts/run-migrations.mjs
 * 通过 drizzle-orm/node-postgres/migrator 执行。凭据从 secure-run 注入的环境读取。
 */
import { defineConfig } from "drizzle-kit"

const url =
  process.env["GEO_FOUNDRY_PG_CONNECTION_STRING"] ??
  "postgresql://build:build@127.0.0.1:1/geo_foundry?options=-c+search_path%3Dgeo_foundry"

export default defineConfig({
  dbCredentials: { url },
  dialect: "postgresql",
  migrations: { schema: "geo_foundry", table: "drizzle_migrations" },
  out: "./drizzle",
  schema: "./src/server/db/*.ts",
  schemaFilter: ["geo_foundry"],
  strict: true,
  verbose: true,
})

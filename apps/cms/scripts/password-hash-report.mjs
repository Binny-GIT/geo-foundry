/*
 * 密码哈希迁移进度报告：按 hash 串前缀统计各算法的存量用户数。
 * 只读；旧 PBKDF2 用户登录后会自动重哈希为 scrypt（routes/auth.ts）。
 */
import { sql } from "drizzle-orm"

import { serverRuntime } from "../src/server/runtime.ts"

const rows = await serverRuntime().db.execute<{ algorithm: string; count: string }>(sql`
  SELECT CASE
      WHEN hash LIKE '$scrypt$%' THEN 'scrypt'
      WHEN hash IS NULL OR hash = '' THEN 'none'
      ELSE 'pbkdf2-legacy'
    END AS algorithm,
    count(*)::text AS count
  FROM geo_foundry.users
  GROUP BY 1
  ORDER BY 1
`)
const report = { at: new Date().toISOString(), rows: rows.rows ?? rows }
console.log(JSON.stringify(report))
const legacy = Number((report.rows as { algorithm: string; count: string }[]).find((row) => row.algorithm === "pbkdf2-legacy")?.count ?? 0)
if (legacy > 0) {
  console.error(`${legacy} user(s) still on legacy PBKDF2; they upgrade on next successful login`)
}
process.exit(0)

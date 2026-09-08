/*
 * pg-boss C0 spike：在独立 spike 库验证四件事，任一失败即退出码非 0。
 * 1) fromDrizzle 适配器把 send() 挂进业务事务：回滚任务随之消失；
 * 2) 受限 role（仅 pgboss schema 权限）能 work() 消费，但读业务表被拒；
 * 3) singletonKey 去重：同 key 未完成时再 send 返回 null；
 * 4) cron schedule 同名幂等，两个实例 75s 内只触发一次。
 */
import { PgBoss, fromDrizzle } from "pg-boss"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { sql } from "drizzle-orm"

const ADMIN = process.env.SPIKE_ADMIN_URL
const WORKER = process.env.SPIKE_WORKER_URL
if (!ADMIN || !WORKER) throw new Error("SPIKE_ADMIN_URL / SPIKE_WORKER_URL required")

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`)
}

// ---------- 1. 同事务入队（提交 + 回滚） ----------
const adminPool = new Pool({ connectionString: ADMIN })
const db = drizzle(adminPool)
const boss = new PgBoss({ connectionString: ADMIN, schema: "pgboss_spike" })
await boss.start()

// 生产同款授权模型：owner 建好 schema 后一次性授权，并让未来新建的表自动带权限，
// 这样 worker（migrate:false）永远不需要 DDL，业务 schema 一律不授。
await adminPool.query(`
  GRANT USAGE ON SCHEMA pgboss_spike TO spike_worker;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss_spike TO spike_worker;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss_spike TO spike_worker;
  ALTER DEFAULT PRIVILEGES FOR ROLE spike_admin IN SCHEMA pgboss_spike
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spike_worker;
  ALTER DEFAULT PRIVILEGES FOR ROLE spike_admin IN SCHEMA pgboss_spike
    GRANT USAGE, SELECT ON SEQUENCES TO spike_worker;
`)

await db.execute(sql`CREATE TABLE IF NOT EXISTS spike_rows (id serial primary key, note text)`)
await boss.createQueue("spike-q").catch(() => {}) // 已存在则忽略

await db.transaction(async (tx) => {
  await tx.execute(sql`INSERT INTO spike_rows (note) VALUES ('committed')`)
  await boss.send("spike-q", { kind: "commit" }, { db: fromDrizzle(tx, sql) })
})
let jobs = await adminPool.query("SELECT count(*)::int AS n FROM pgboss_spike.job WHERE name='spike-q' AND data->>'kind'='commit'")
check("send in committed tx persists", jobs.rows[0].n === 1)

let rolledBack = false
try {
  await db.transaction(async (tx) => {
    await boss.send("spike-q", { kind: "rollback" }, { db: fromDrizzle(tx, sql) })
    throw new Error("intended rollback")
  })
} catch {
  rolledBack = true
}
jobs = await adminPool.query("SELECT count(*)::int AS n FROM pgboss_spike.job WHERE data->>'kind'='rollback'")
check("send in rolled-back tx vanishes", rolledBack && jobs.rows[0].n === 0)

// ---------- 2. 受限 role 消费 / 业务表隔离 ----------
const workerBoss = new PgBoss({
  connectionString: WORKER,
  migrate: false,
  schema: "pgboss_spike",
})
await workerBoss.start()
let consumed = null
await workerBoss.work("spike-q", async (job) => {
  if (job.data.kind === "commit") consumed = job.id
})
await new Promise((resolve) => setTimeout(resolve, 2_000))
check("restricted role consumed job", consumed !== null)

const workerPool = new Pool({ connectionString: WORKER })
let denied = false
try {
  await workerPool.query("SELECT * FROM spike_rows LIMIT 1")
} catch (error) {
  denied = error.code === "42501"
}
check("restricted role denied on business table", denied)
await workerPool.end()

// ---------- 3. singletonKey 去重 ----------
await boss.createQueue("spike-singleton").catch(() => {})
const first = await boss.send("spike-singleton", { n: 1 }, { singletonKey: "op:1:stage" })
const second = await boss.send("spike-singleton", { n: 2 }, { singletonKey: "op:1:stage" })
check("singletonKey dedupes in-flight send", first !== null && second === null)

// ---------- 4. cron 同名幂等 + 单实例语义 ----------
const cron = "* * * * *"
await boss.schedule("spike-cron", cron, {}, { tz: "UTC" })
await boss.schedule("spike-cron", cron, {}, { tz: "UTC" })
const cronRows = await adminPool.query("SELECT count(*)::int AS n FROM pgboss_spike.cron WHERE name='spike-cron'")
check("duplicate schedule() is idempotent", cronRows.rows[0].n === 1)

let cronCount = 0
await boss.work("spike-cron", async () => {
  cronCount += 1
})
const deadline = Date.now() + 80_000
while (Date.now() < deadline && cronCount === 0) await new Promise((r) => setTimeout(r, 1_000))
await new Promise((r) => setTimeout(r, 5_000))
check("cron fired exactly once across instances", cronCount === 1, `count=${cronCount}`)

await boss.stop()
await workerBoss.stop()
await adminPool.end()
const failed = results.filter((r) => !r.ok)
console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length }))
process.exit(failed.length === 0 ? 0 : 1)

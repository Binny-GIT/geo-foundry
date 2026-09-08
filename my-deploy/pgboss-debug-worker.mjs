import { PgBoss } from "pg-boss"
import pg from "pg"

const ADMIN = process.env.SPIKE_ADMIN_URL
const WORKER = process.env.SPIKE_WORKER_URL

const adminPool = new pg.Pool({ connectionString: ADMIN })
const state = await adminPool.query("SELECT id, state, start_after, policy FROM pgboss_spike.job WHERE name='spike-q'")
console.log("jobs:", JSON.stringify(state.rows))

// worker 视角：直接查 job 行（权限探测）
const workerPool = new pg.Pool({ connectionString: WORKER })
try {
  const w = await workerPool.query("SELECT count(*)::int AS n FROM pgboss_spike.job WHERE name='spike-q'")
  console.log("worker can SELECT job:", w.rows[0].n)
} catch (error) {
  console.log("worker SELECT failed:", error.code, String(error.message).slice(0, 120))
}
await workerPool.end()

const boss = new PgBoss({ connectionString: WORKER, migrate: false, schema: "pgboss_spike" })
boss.on("error", (e) => console.log("boss-error:", String(e).slice(0, 200)))
boss.on("warning", (w) => console.log("boss-warning:", String(w).slice(0, 200)))
await boss.start()
console.log("worker started")
let got = null
const work = await boss.work("spike-q", async (job) => {
  got = job.id
  console.log("consumed:", job.id)
})
console.log("work registered:", typeof work)
for (let i = 0; i < 6 && got === null; i += 1) {
  await new Promise((r) => setTimeout(r, 3_000))
  console.log("waiting...", i)
}
const after = await adminPool.query("SELECT state, count(*)::int AS n FROM pgboss_spike.job WHERE name='spike-q' GROUP BY 1")
console.log("after:", JSON.stringify(after.rows))
await boss.stop()
await adminPool.end()
process.exit(0)

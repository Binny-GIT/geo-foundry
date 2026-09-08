/*
 * pg-boss 一次性初始化（部署序列执行，幂等）：
 * 1. 以 CMS 数据库身份 start() 建 pgboss schema 与系统表；
 * 2. 创建四条业务队列（short policy + 3 次指数退避重试 + 完成 1 天保留）；
 * 3. 授予 worker 受限角色 pgboss schema 权限（USAGE+CREATE+DML+默认权限），
 *    业务 schema 一律不授——worker 的业务读写仍只走 internal HTTP API。
 *
 * 环境变量：GEO_FOUNDRY_PGBOSS_WORKER_ROLE（默认 geo_worker）。
 */
import { PgBoss } from "pg-boss"

import { serverRuntime } from "../src/server/runtime.ts"
import { JOB_QUEUE, PGBOSS_SCHEMA, QUEUE_CREATION_OPTIONS } from "../src/server/jobs/pgboss.ts"

const workerRole = process.env.GEO_FOUNDRY_PGBOSS_WORKER_ROLE ?? "geo_worker"

const pool = serverRuntime().pool
const boss = new PgBoss({
  db: {
    executeSql: async (text, values) => pool.query(text, values),
  },
  schema: PGBOSS_SCHEMA,
})

await boss.start()
const queues = Object.values(JOB_QUEUE)
for (const queue of queues) {
  // createQueue 不支持原地改 policy；重建部署时如需变更策略，先删队列再建。
  await boss.createQueue(queue, { ...QUEUE_CREATION_OPTIONS }).catch((error) => {
    throw new Error(`PGBOSS_QUEUE_CREATE_FAILED:${queue}:${String(error)}`)
  })
}

// 授权模型与 C0 spike 一致：worker 角色能在 pgboss schema 消费与建日分区，
// 对 geo_foundry 业务 schema 没有任何权限。
await pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerRole}') THEN
      RAISE EXCEPTION 'PGBOSS_WORKER_ROLE_MISSING:${workerRole}';
    END IF;
  END $$;
`)
await pool.query(`
  GRANT USAGE, CREATE ON SCHEMA ${PGBOSS_SCHEMA} TO ${workerRole};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${workerRole};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${workerRole};
  ALTER DEFAULT PRIVILEGES IN SCHEMA ${PGBOSS_SCHEMA}
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${workerRole};
  ALTER DEFAULT PRIVILEGES IN SCHEMA ${PGBOSS_SCHEMA}
    GRANT USAGE, SELECT ON SEQUENCES TO ${workerRole};
`)
await boss.stop()
console.log(JSON.stringify({ code: "PGBOSS_PROVISIONED", queues, schema: PGBOSS_SCHEMA, workerRole }))
process.exit(0)

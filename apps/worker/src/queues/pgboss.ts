/*
 * pg-boss 消费端运行时（worker）。
 *
 * 与 CMS 共用 pgboss schema；worker 使用受限 role（仅 pgboss schema 权限，
 * 业务读写仍走 CMS internal HTTP API）。任务由 CMS 在业务事务内 send，
 * 队列与授权由 CMS 侧 provision-pgboss 一次性建好——worker 不做 DDL。
 *
 * cron：rss-poll-due / publication-dispatch-due 每分钟各触发一次，处理器
 * 调 CMS internal 端点（dispatch-due / poll-due），取代 CMS 进程内定时器。
 * schedule() 幂等，多实例由 schedule 表唯一名保证只触发一次。
 */

import { PgBoss } from "pg-boss"

import { workerCredentialOf } from "../config/credentials.js"

export const PGBOSS_SCHEMA = "pgboss"

export const JOB_QUEUE = {
  embedding: "content-embedding",
  evaluation: "operation-evaluation",
  generation: "operation-generation",
  intake: "content-intake",
  maintenance: "worker-maintenance",
  publish: "operation-publish",
} as const

/** Concurrency by workload: heavy generation is narrow, gates are serial. */
export const QUEUE_CONCURRENCY: Readonly<Record<string, number>> = {
  embedding: 4,
  evaluation: 4,
  generation: 2,
  intake: 2,
  maintenance: 1,
  publish: 1,
}

export type WorkerBossOptions = {
  readonly connectionString: string
}

export const createWorkerBoss = (options: WorkerBossOptions): PgBoss =>
  new PgBoss({
    connectionString: options.connectionString,
    createSchema: false,
    migrate: false,
    schema: PGBOSS_SCHEMA,
  })

export const workerPgConnectionString = (): string => {
  const url = workerCredentialOf(process.env, "GEO_FOUNDRY_WORKER_PG_URL")
  if (url.length === 0) {
    throw new Error("WORKER_PG_URL_MISSING")
  }
  return url
}


export const CRON_SCHEDULES: readonly { readonly cron: string; readonly name: string }[] = [
  { cron: "* * * * *", name: "publication-dispatch-due" },
  { cron: "* * * * *", name: "rss-poll-due" },
]

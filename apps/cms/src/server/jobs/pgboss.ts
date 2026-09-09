/*
 * pg-boss 队列接入（CMS 发布端）。
 *
 * 关键机制：send() 通过 fromDrizzle(tx, sql) 挂进业务事务——operation 行、
 * 幂等记录与任务在同一事务提交或回滚。队列与授权由
 * scripts/provision-pgboss.mjs 一次性建好（schema "pgboss"）；CMS
 * 运行时实例不做 DDL（migrate:false）。
 *
 * 去重：operation/intake 队列均为 short policy，singletonKey 保证同键在
 * created 态不可重复入队（等价旧 BullMQ 稳定 jobId 语义）。
 */

import { sql } from "drizzle-orm"
import type { Pool, QueryResult } from "pg"
import { fromDrizzle, PgBoss } from "pg-boss"

import type { ServerDb } from "../db/client"
import { serverRuntime } from "../runtime"

export const PGBOSS_SCHEMA = "pgboss"

export const JOB_QUEUE = {
  embedding: "content-embedding",
  evaluation: "operation-evaluation",
  generation: "operation-generation",
  intake: "content-intake",
  publish: "operation-publish",
} as const

export type OperationQueueName = "evaluation" | "generation" | "publish"

const OPERATION_QUEUE_OF: Record<string, OperationQueueName> = {
  evaluate: "evaluation",
  generate: "generation",
  publish: "publish",
  rollback: "publish",
}

const OPERATION_STAGE_OF: Record<string, string> = {
  evaluate: "evaluation",
  generate: "generation",
  publish: "publish-gate",
  rollback: "rollback-gate",
}

export const operationQueueOf = (operationType: string): OperationQueueName => {
  const queue = OPERATION_QUEUE_OF[operationType]
  if (queue === undefined) throw new Error(`JOB_OPERATION_TYPE_INVALID:${operationType}`)
  return queue
}

/** 与旧 BullMQ workJobOptions 对齐：3 次重试、指数退避、完成保留 1 天。 */
export const QUEUE_CREATION_OPTIONS = {
  deleteAfterSeconds: 86_400,
  expireInSeconds: 3_600,
  policy: "short",
  retryBackoff: true,
  retryDelay: 2,
  retryLimit: 3,
} as const

export type OperationJobData = Readonly<{
  kind: "operation"
  operationId: string
  operationType: string
  payload: Record<string, unknown>
  /** worker 侧终端阶段名（publish 队列用它分派 publish-gate/rollback-gate）。 */
  stage: string
  tenantId: number
}>

export type IntakeJobData = Readonly<{
  intakeItemId: number
  kind: "intake"
  tenantId: number
}>

const poolAdapter = (pool: Pool) => ({
  executeSql: async (text: string, values?: unknown[]): Promise<QueryResult> =>
    pool.query(text, values as unknown[]),
})

type TxLike = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

let bossPromise: Promise<PgBoss> | null = null

/** CMS 侧 boss 单例：不做 DDL，只承担事务内/即时 send 与队列缓存。 */
export const cmsBoss = (): Promise<PgBoss> => {
  bossPromise ??= (async () => {
    const boss = new PgBoss({
      createSchema: false,
      db: poolAdapter(serverRuntime().pool),
      migrate: false,
      schema: PGBOSS_SCHEMA,
      supervise: false,
    })
    await boss.start()
    return boss
  })()
  return bossPromise
}

export const sendOperationJobWithin = async (
  tx: TxLike,
  input: Omit<OperationJobData, "stage">,
): Promise<string | null> => {
  const boss = await cmsBoss()
  const stage = OPERATION_STAGE_OF[input.operationType]
  if (stage === undefined) throw new Error(`JOB_OPERATION_TYPE_INVALID:${input.operationType}`)
  return boss.send(
    JOB_QUEUE[operationQueueOf(input.operationType)],
    { ...input, stage },
    {
      db: fromDrizzle(tx, sql),
      singletonKey: input.operationId,
    },
  )
}

export const sendIntakeJob = async (input: IntakeJobData): Promise<string | null> => {
  const boss = await cmsBoss()
  return boss.send(JOB_QUEUE.intake, input, { singletonKey: `intake-${input.intakeItemId}` })
}

export type EditionEmbeddingJobData = Readonly<{
  editionId: number
  kind: "embedding"
  operationId: string
  stage: "embedding"
  tenantId: number
}>

/** 草稿写入或恢复后重建向量，使用稳定的 embed-ed-<id> 去重键。 */
export const sendEditionEmbeddingJobWithin = async (
  tx: TxLike,
  input: Readonly<{ editionId: number; tenantId: number }>,
): Promise<string | null> => {
  const boss = await cmsBoss()
  return boss.send(
    JOB_QUEUE.embedding,
    {
      editionId: input.editionId,
      kind: "embedding",
      operationId: `edition-${input.editionId}`,
      payload: { editionId: input.editionId },
      stage: "embedding",
      tenantId: input.tenantId,
    },
    { db: fromDrizzle(tx, sql), singletonKey: `embed-ed-${input.editionId}` },
  )
}

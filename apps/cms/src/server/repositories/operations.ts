/*
 * Operations + Idempotency + Outbox 的事务仓储。
 *
 * 跨实例幂等由数据库完成：同一 uniqueKey 先取得 transaction-level advisory
 * lock，再判断 replay/create；新请求的三张表写入同一事务，任何一步失败
 * 都整体回滚。进程内 Map 只能减流，不能成为正确性边界。
 */

import { and, eq, sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import {
  idempotencyRecords,
  operations,
  type operationState,
  type operationType,
} from "../db/ledger-schema"
import { sendOperationJobWithin } from "../jobs/pgboss"
import { IdempotencyConflictError } from "../errors"

type OperationType = (typeof operationType.enumValues)[number]
type OperationState = (typeof operationState.enumValues)[number]

export type SubmitOperationRecordInput = Readonly<{
  auditLog: readonly Record<string, unknown>[]
  endpoint: string
  idempotencyKey: string
  idempotencyKeyHash: string
  operationId: string
  operationType: OperationType
  requestHash: string
  requestPayload: Record<string, unknown>
  siteId?: number
  targetIds: Record<string, unknown>
  tenantId: number
  /** 数据库唯一仲裁键：tenant + endpoint + caller idempotency key。 */
  uniqueKey: string
  outbox?: Readonly<{
    aggregateId: number
    aggregateType?: "edition" | "site"
    eventPayload: Record<string, unknown>
    requestId?: string
    type: string
  }>
}>

export type SubmitOperationRecordOutcome = Readonly<{
  created: boolean
  operationId: string
  state: OperationState
}>

export class OperationsRepository {
  constructor(private readonly db: ServerDb) {}

  async submit(input: SubmitOperationRecordInput): Promise<SubmitOperationRecordOutcome> {
    return this.db.transaction(async (tx) => {
      // hashtext 冲突只会造成不相关请求短暂串行，不影响正确性。
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.uniqueKey}))`)

      const existingRows = await tx
        .select({
          operationId: idempotencyRecords.operationId,
          requestHash: idempotencyRecords.requestHash,
        })
        .from(idempotencyRecords)
        .where(eq(idempotencyRecords.uniqueKey, input.uniqueKey))
        .limit(1)
      const existing = existingRows[0]
      if (existing !== undefined) {
        if (existing.requestHash !== input.requestHash) throw new IdempotencyConflictError()
        await tx
          .update(idempotencyRecords)
          .set({
            replayCount: sql`COALESCE(${idempotencyRecords.replayCount}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(eq(idempotencyRecords.uniqueKey, input.uniqueKey))
        const operationRows = await tx
          .select({ operationId: operations.operationId, state: operations.state })
          .from(operations)
          .where(eq(operations.operationId, existing.operationId))
          .limit(1)
        const operation = operationRows[0]
        if (operation === undefined) {
          throw new Error(`idempotency operation missing: ${existing.operationId}`)
        }
        return { created: false, operationId: operation.operationId, state: operation.state }
      }

      await tx.insert(operations).values({
        auditLog: [...input.auditLog],
        attempt: 1,
        endpoint: input.endpoint,
        error: null,
        idempotencyKeyHash: input.idempotencyKeyHash,
        operationId: input.operationId,
        operationType: input.operationType,
        requestPayload: input.requestPayload,
        revision: 0,
        result: null,
        ...(input.siteId === undefined ? {} : { siteId: input.siteId }),
        state: "queued",
        targetIds: input.targetIds,
        tenantId: input.tenantId,
      })
      await tx.insert(idempotencyRecords).values({
        endpoint: input.endpoint,
        idempotencyKey: input.idempotencyKey,
        operationId: input.operationId,
        replayCount: 0,
        requestHash: input.requestHash,
        tenantId: input.tenantId,
        uniqueKey: input.uniqueKey,
      })
      if (input.outbox !== undefined) {
        // 同事务入队：operation 与任务原子提交，outbox/dispatcher/reconcile 不复存在。
        await sendOperationJobWithin(tx, {
          kind: "operation",
          operationId: input.operationId,
          operationType: input.operationType,
          payload: (input.outbox.eventPayload ?? {}) as Record<string, unknown>,
          tenantId: input.tenantId,
        })
      }
      return { created: true, operationId: input.operationId, state: "queued" }
    })
  }

  async incrementReplayCount(uniqueKey: string): Promise<number | null> {
    const rows = await this.db
      .update(idempotencyRecords)
      .set({
        replayCount: sql`COALESCE(${idempotencyRecords.replayCount}, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(idempotencyRecords.uniqueKey, uniqueKey)))
      .returning({ replayCount: idempotencyRecords.replayCount })
    return rows[0] === undefined ? null : Number(rows[0].replayCount ?? 0)
  }
}

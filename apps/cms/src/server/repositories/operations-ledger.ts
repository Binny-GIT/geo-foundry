/*
 * Operations 台账 Drizzle 仓储：get / start / complete / cancel。
 * 状态机仍走 @geo/domain.transitionOperation；审计追加与 revision CAS 同事务；
 * 契约（错误码、快照形状）与 services/operations-ledger.ts 保持一致。
 */

import {
  type AuditActor,
  type Clock,
  createServiceAuditActor,
  parseInstant,
  parseOperationId,
  parseSha256Hash,
  parseSiteId,
  parseTenantId,
  transitionOperation,
} from "@geo/domain"
import { and, eq } from "drizzle-orm"

import { resolveSessionClaims } from "../../access/session"
import { OperationsLedgerError } from "../../services/operations-ledger"
import type { ServerDb } from "../db/client"
import { operations } from "../db/ledger-schema"

type OperationRow = typeof operations.$inferSelect
type OperationState = OperationRow["state"]

export type OperationSnapshot = {
  readonly requestPayload: Record<string, unknown>
  readonly attempt: number
  readonly currentStage: string | null
  readonly endpoint: string
  readonly error: Record<string, unknown> | null
  readonly operationId: string
  readonly operationType: string
  readonly result: Record<string, unknown> | null
  readonly state: OperationState
  readonly tenantId: number
}

const fail = (code: string): OperationsLedgerError => new OperationsLedgerError(code, code)

const clock: Clock = {
  now: () => {
    const instant = parseInstant(new Date().toISOString())
    if (!instant.ok) throw fail("OPERATION_CLOCK_INVALID")
    return instant.value
  },
}

const snapshotOf = (row: OperationRow): OperationSnapshot => ({
  attempt: row.attempt ?? 1,
  currentStage:
    typeof row.currentStage === "string" && row.currentStage.length > 0 ? row.currentStage : null,
  endpoint: String(row.endpoint),
  error: (row.error as Record<string, unknown> | null) ?? null,
  operationId: row.operationId,
  operationType: row.operationType,
  requestPayload: (row.requestPayload as Record<string, unknown> | null) ?? {},
  result: (row.result as Record<string, unknown> | null) ?? null,
  state: row.state,
  tenantId: row.tenantId ?? -1,
})

const serviceClaimsOf = (user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw fail("OPERATIONS_ACTOR_INVALID")
  }
  return claims
}

const loadByOperationId = async (db: ServerDb, operationId: string): Promise<OperationRow> => {
  const rows = await db
    .select()
    .from(operations)
    .where(eq(operations.operationId, operationId))
    .limit(1)
  const row = rows[0]
  if (row === undefined) throw fail("OPERATION_NOT_FOUND")
  return row
}

const assertTenantScope = (
  claims: ReturnType<typeof serviceClaimsOf>,
  row: OperationRow,
): number => {
  const tenantId = row.tenantId ?? -1
  const claimsTenant = Number(claims.tenantId ?? -1)
  if (claimsTenant !== tenantId) throw fail("OPERATION_TENANT_MISMATCH")
  return tenantId
}

const aggregateOf = (row: OperationRow) => {
  const parsedId = parseOperationId(row.operationId)
  const parsedKeyHash = parseSha256Hash(String(row.idempotencyKeyHash ?? ""))
  const tenantId = parseTenantId(String(row.tenantId ?? -1))
  if (!parsedId.ok || !parsedKeyHash.ok || !tenantId.ok) {
    throw fail("OPERATION_STATE_INVALID")
  }
  const ownership =
    row.siteId === null
      ? Object.freeze({ scope: "tenant" as const, tenantId: tenantId.value })
      : Object.freeze({
          scope: "site" as const,
          siteId: (parseSiteId(String(row.siteId)).ok ? row.siteId : -1) as number,
          tenantId: tenantId.value,
        })
  return Object.freeze({
    attempt: row.attempt ?? 1,
    audit: [],
    id: parsedId.value,
    idempotencyKeyHash: parsedKeyHash.value,
    ownership: ownership as never,
    revision: row.revision ?? 0,
    retryOf: null,
    state: row.state,
  })
}

const transitionActorOf = (row: OperationRow): AuditActor => {
  const parsedOperation = parseOperationId(row.operationId)
  const parsedTenant = parseTenantId(String(row.tenantId ?? -1))
  if (!parsedOperation.ok || !parsedTenant.ok) throw fail("OPERATION_STATE_INVALID")
  return createServiceAuditActor({
    operationId: parsedOperation.value,
    tenantId: parsedTenant.value,
  })
}

const serializedActorOf = (user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null) return null
  return {
    kind: claims.kind,
    role: claims.role,
    tenantId: claims.tenantId,
    userId: claims.userId,
  }
}

export const getOperation = async (
  db: ServerDb,
  operationId: string,
  user: unknown,
): Promise<OperationSnapshot> => {
  const claims = serviceClaimsOf(user)
  const row = await loadByOperationId(db, operationId)
  assertTenantScope(claims, row)
  return snapshotOf(row)
}

const STAGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

type StageContext = { claims: ReturnType<typeof serviceClaimsOf>; row: OperationRow }

const loadForStage = async (
  tx: Parameters<Parameters<ServerDb["transaction"]>[0]>[0],
  input: { readonly attempt: number; readonly operationId: string; readonly user: unknown },
): Promise<StageContext> => {
  const claims = serviceClaimsOf(input.user)
  const rows = await tx
    .select()
    .from(operations)
    .where(eq(operations.operationId, input.operationId))
    .limit(1)
    .for("update")
  const row = rows[0]
  if (row === undefined) throw fail("OPERATION_NOT_FOUND")
  assertTenantScope(claims, row)
  const currentAttempt = row.attempt ?? 1
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt !== currentAttempt) {
    throw fail("OPERATION_ATTEMPT_STALE")
  }
  return { claims, row }
}

const appendAudit = async (
  tx: Parameters<Parameters<ServerDb["transaction"]>[0]>[0],
  row: OperationRow,
  entry: Record<string, unknown>,
  data: Partial<{
    currentStage: string | null
    error: unknown
    lastStageAt: Date
    result: unknown
    state: OperationState
  }>,
): Promise<void> => {
  const existingAudit = Array.isArray(row.auditLog) ? row.auditLog : []
  const revision = row.revision ?? 0
  const updated = await tx
    .update(operations)
    .set({
      auditLog: [...existingAudit, entry],
      revision: revision + 1,
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(operations.id, row.id), eq(operations.revision, row.revision ?? 0)))
    .returning({ id: operations.id })
  if (updated.length === 0) throw fail("OPERATION_REVISION_CONFLICT")
}

export const startOperationStage = async (
  db: ServerDb,
  input: {
    readonly attempt: number
    readonly operationId: string
    readonly stage: string
    readonly user: unknown
  },
): Promise<OperationSnapshot> => {
  if (!STAGE_PATTERN.test(input.stage)) throw fail("OPERATION_STAGE_INVALID")
  return db.transaction(async (tx) => {
    const { row } = await loadForStage(tx, input)
    const aggregate = aggregateOf(row)
    const actor = serializedActorOf(input.user)
    if (actor === null) throw fail("OPERATIONS_INPUT_INVALID")
    const entry = {
      action: `operation.stage.started:${input.stage}`,
      actor,
      at: clock.now().value,
      detail: { attempt: input.attempt, stage: input.stage },
    }
    if (row.state === "queued") {
      const transitioned = transitionOperation(aggregate, "running", {
        actor: transitionActorOf(row),
        clock,
        expectedRevision: aggregate.revision,
      })
      if (!transitioned.ok) throw fail(transitioned.error.code)
      await appendAudit(tx, row, entry, {
        currentStage: input.stage,
        lastStageAt: new Date(),
        state: "running",
      })
    } else if (row.state === "running") {
      await appendAudit(tx, row, entry, {
        currentStage: input.stage,
        lastStageAt: new Date(),
      })
    } else {
      throw fail("OPERATION_TRANSITION_NOT_ALLOWED")
    }
    return snapshotOf(await loadByOperationId(db, input.operationId))
  })
}

export const completeOperationStage = async (
  db: ServerDb,
  input: {
    readonly attempt: number
    readonly error?: Record<string, unknown>
    readonly operationId: string
    readonly outcome: "failed" | "succeeded"
    readonly result?: Record<string, unknown>
    readonly stage: string
    readonly user: unknown
  },
): Promise<OperationSnapshot> => {
  if (!STAGE_PATTERN.test(input.stage)) throw fail("OPERATION_STAGE_INVALID")
  if (input.outcome === "succeeded" && input.result === undefined) {
    throw fail("OPERATIONS_INPUT_INVALID")
  }
  if (input.outcome === "failed" && input.error === undefined) {
    throw fail("OPERATIONS_INPUT_INVALID")
  }
  return db.transaction(async (tx) => {
    const { row } = await loadForStage(tx, input)
    const aggregate = aggregateOf(row)
    const actor = serializedActorOf(input.user)
    if (actor === null) throw fail("OPERATIONS_INPUT_INVALID")
    const entry = {
      action: `operation.stage.completed:${input.stage}`,
      actor,
      at: clock.now().value,
      detail: { attempt: input.attempt, outcome: input.outcome, stage: input.stage },
    }
    const transitioned = transitionOperation(aggregate, input.outcome, {
      actor: transitionActorOf(row),
      clock,
      expectedRevision: aggregate.revision,
    })
    if (!transitioned.ok) throw fail(transitioned.error.code)
    await appendAudit(tx, row, entry, {
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.result === undefined ? {} : { result: input.result }),
      state: input.outcome,
    })
    return snapshotOf(await loadByOperationId(db, input.operationId))
  })
}

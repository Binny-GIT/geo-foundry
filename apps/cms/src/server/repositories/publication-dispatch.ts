/*
 * 定时发布调度（worker 侧）的 Drizzle 实现。
 * 计划行先经 revision CAS 从 pending→running 认领，再以计划申请人（publisher）
 * 的身份提交 publish operation；worker 在两步之间崩溃时，后续循环会接管
 * 无 operationId 的 running 计划，operation 幂等键仍是跨进程仲裁者。
 */

import { and, asc, eq, lte, sql } from "drizzle-orm"

import { resolveSessionClaims } from "../../access/session"
import type { ServerDb } from "../db/client"
import { users } from "../db/schema"
import { publicationPlans } from "../db/session-schema"
import type { WorkflowClaims } from "./edition-workflow"
import { getOperation } from "./operations-ledger"
import { submitEditionPublishOperation } from "./publish-operations"

export class PublicationPlansError extends Error {
  override readonly name = "PublicationPlansError"
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

type PlanRow = typeof publicationPlans.$inferSelect

const CLAIM_LEASE_MS = 30_000

const instantOf = (value: string): string => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PublicationPlansError("PUBLICATION_PLAN_INSTANT_INVALID")
  }
  return value
}

export type DuePublicationPlan = Readonly<{ operationId: string; planId: string }>

const updatePlan = async (
  db: ServerDb,
  plan: PlanRow,
  data: Partial<
    Pick<PlanRow, "lastError" | "operationId" | "publishedAt" | "releaseId" | "status">
  >,
  expectedStatus: "pending" | "running",
): Promise<boolean> => {
  const revision = plan.revision ?? 0
  const updated = await db
    .update(publicationPlans)
    .set({ ...data, revision: revision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(publicationPlans.id, plan.id),
        eq(publicationPlans.revision, revision),
        eq(publicationPlans.status, expectedStatus),
      ),
    )
    .returning({ id: publicationPlans.id })
  return updated.length === 1
}

const claimPlan = async (
  db: ServerDb,
  plan: PlanRow,
  input: { readonly incrementAttempts: boolean; readonly now: string; readonly workerId: string },
): Promise<boolean> => {
  if (plan.status !== "pending" && plan.status !== "running") return false
  const revision = plan.revision ?? 0
  const claimed = await db
    .update(publicationPlans)
    .set({
      attempts: sql`${publicationPlans.attempts} + ${input.incrementAttempts ? 1 : 0}`,
      claimedAt: new Date(input.now),
      claimedBy: input.workerId,
      revision: revision + 1,
      status: "running",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(publicationPlans.id, plan.id),
        eq(publicationPlans.revision, revision),
        eq(publicationPlans.status, plan.status),
      ),
    )
    .returning({ id: publicationPlans.id })
  return claimed.length === 1
}

const planByPlanId = async (db: ServerDb, planId: string): Promise<PlanRow | null> => {
  const rows = await db
    .select()
    .from(publicationPlans)
    .where(eq(publicationPlans.planId, planId))
    .limit(1)
  return rows[0] ?? null
}

const resumableClaim = (plan: PlanRow, now: string): boolean =>
  plan.claimedAt === null || plan.claimedAt.getTime() + CLAIM_LEASE_MS <= Date.parse(now)

const settleRunningPlans = async (
  db: ServerDb,
  now: string,
  tenantId: number,
  user: unknown,
): Promise<void> => {
  const running = await db
    .select()
    .from(publicationPlans)
    .where(and(eq(publicationPlans.status, "running"), eq(publicationPlans.tenantId, tenantId)))
    .limit(100)
  for (const plan of running) {
    if (plan.operationId === null || plan.operationId.length === 0) continue
    const operation = await getOperation(db, plan.operationId, user).catch(() => null)
    if (
      operation === null ||
      (operation.state !== "succeeded" &&
        operation.state !== "failed" &&
        operation.state !== "cancelled")
    ) {
      continue
    }
    const status = operation.state === "succeeded" ? "succeeded" : "failed"
    await updatePlan(
      db,
      plan,
      status === "succeeded"
        ? {
            publishedAt: new Date(now),
            releaseId:
              typeof operation.result?.["releaseId"] === "string"
                ? operation.result["releaseId"]
                : null,
            status,
          }
        : { lastError: String(operation.error?.["code"] ?? operation.state), status },
      "running",
    )
  }
}

const operationAttachedToPlan = async (
  db: ServerDb,
  planId: string,
): Promise<DuePublicationPlan | null> => {
  const current = await planByPlanId(db, planId)
  const operationId = current?.operationId ?? null
  return operationId === null || operationId.length === 0 ? null : { operationId, planId }
}

const publisherClaimsOf = (row: typeof users.$inferSelect): WorkflowClaims | null => {
  const claims = resolveSessionClaims({ id: row.id, role: row.role, tenant: row.tenantId })
  if (claims === null) return null
  return {
    kind: claims.kind,
    role: claims.role,
    tenantId: claims.tenantId === null ? null : Number(claims.tenantId),
    userId: claims.userId,
  }
}

const attachPublishOperation = async (
  db: ServerDb,
  plan: PlanRow,
): Promise<DuePublicationPlan | null> => {
  const existing = await operationAttachedToPlan(db, plan.planId)
  if (existing !== null) return existing
  const publisherRows = await db
    .select()
    .from(users)
    .where(eq(users.id, plan.requestedById))
    .limit(1)
  const publisher = publisherRows[0]
  const claims = publisher === undefined ? null : publisherClaimsOf(publisher)
  if (claims === null) {
    await updatePlan(
      db,
      plan,
      { lastError: "PUBLICATION_PLAN_REQUESTER_NOT_FOUND", status: "failed" },
      "running",
    )
    return null
  }
  try {
    const outcome = await submitEditionPublishOperation(db, {
      claims,
      editionId: plan.editionId,
      reason: `Scheduled publication ${plan.planId}`,
    })
    const attached = await updatePlan(db, plan, { operationId: outcome.operationId }, "running")
    if (attached) return { operationId: outcome.operationId, planId: plan.planId }
    return operationAttachedToPlan(db, plan.planId)
  } catch (error) {
    const attached = await operationAttachedToPlan(db, plan.planId)
    if (attached !== null) return attached
    const code = error instanceof Error ? error.message : "PUBLICATION_PLAN_OPERATION_FAILED"
    await updatePlan(db, plan, { lastError: code.slice(0, 500), status: "failed" }, "running")
    return null
  }
}

export const dispatchDuePublicationPlans = async (
  db: ServerDb,
  input: { readonly now: string; readonly workerId: string; readonly user: unknown },
): Promise<readonly DuePublicationPlan[]> => {
  const now = instantOf(input.now)
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    claims.kind !== "service" ||
    claims.role !== "content-service" ||
    claims.tenantId === null
  ) {
    throw new PublicationPlansError("PUBLICATION_PLAN_SERVICE_REQUIRED")
  }
  const tenantId = Number(claims.tenantId)

  await settleRunningPlans(db, now, tenantId, input.user)
  const runningWithoutOperation = await db
    .select()
    .from(publicationPlans)
    .where(and(eq(publicationPlans.status, "running"), eq(publicationPlans.tenantId, tenantId)))
    .limit(20)
  const resumed: DuePublicationPlan[] = []
  for (const plan of runningWithoutOperation) {
    if ((plan.operationId ?? "").length > 0 || !resumableClaim(plan, now)) continue
    const claimed = await claimPlan(db, plan, {
      incrementAttempts: false,
      now,
      workerId: input.workerId,
    })
    if (!claimed) continue
    const current = await planByPlanId(db, plan.planId)
    if (current === null || current.claimedBy !== input.workerId) continue
    const attached = await attachPublishOperation(db, current)
    if (attached !== null) resumed.push(attached)
  }

  const due = await db
    .select()
    .from(publicationPlans)
    .where(
      and(
        eq(publicationPlans.status, "pending"),
        eq(publicationPlans.tenantId, tenantId),
        lte(publicationPlans.scheduledFor, new Date(now)),
      ),
    )
    .orderBy(asc(publicationPlans.scheduledFor))
    .limit(20)
  const claimed: DuePublicationPlan[] = []
  for (const plan of due) {
    const claim = await claimPlan(db, plan, {
      incrementAttempts: true,
      now,
      workerId: input.workerId,
    })
    if (!claim) continue
    // 数据库认领是仲裁者：重读后只有最终租约持有者才提交 operation。
    const current = await planByPlanId(db, plan.planId)
    if (current === null || current.claimedBy !== input.workerId) continue
    const attached = await attachPublishOperation(db, current)
    if (attached !== null) claimed.push(attached)
  }
  return [...resumed, ...claimed]
}

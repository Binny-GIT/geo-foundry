import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"

import { resolveSessionClaims } from "../../access/session"
import { IntakeError } from "../../services/intake"
import type { ServerDb } from "../db/client"
import { connectors, crawlJobs } from "../db/entity-schema"
import { intakeItems } from "../db/session-schema"
import { sendCrawlJobWithin } from "../jobs/pgboss"

export const crawlTenantOf = (user: unknown): number => {
  const claims = resolveSessionClaims(user)
  const tenantId = Number(claims?.tenantId)
  if (
    claims?.kind !== "service" ||
    claims.role !== "content-service" ||
    !Number.isInteger(tenantId) ||
    tenantId <= 0
  ) {
    throw new IntakeError("INTAKE_TENANT_MISMATCH")
  }
  return tenantId
}

export const pollDueCrawlConnectors = async (db: ServerDb, tenantId: number): Promise<void> => {
  const now = new Date()
  const due = await db
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.tenantId, tenantId),
        eq(connectors.type, "crawl"),
        eq(connectors.status, "active"),
        or(
          isNull(connectors.lastPolledAt),
          lt(
            connectors.lastPolledAt,
            sql`${now}::timestamptz - make_interval(mins => ${connectors.pollIntervalMinutes})`,
          ),
        ),
      ),
    )
    .limit(20)
  for (const connector of due) {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(connectors)
        .set({ lastPolledAt: now, updatedAt: now })
        .where(
          and(
            eq(connectors.id, connector.id),
            eq(connectors.tenantId, tenantId),
            or(
              isNull(connectors.lastPolledAt),
              lt(
                connectors.lastPolledAt,
                sql`${now}::timestamptz - make_interval(mins => ${connectors.pollIntervalMinutes})`,
              ),
            ),
          ),
        )
        .returning({ id: connectors.id })
      if (claimed.length === 0 || !connector.sourceEndpoint || !connector.secretReference) return
      const inflight = await tx
        .select({ id: crawlJobs.id })
        .from(crawlJobs)
        .where(
          and(
            eq(crawlJobs.connectorId, connector.id),
            eq(crawlJobs.tenantId, tenantId),
            inArray(crawlJobs.state, ["dispatched", "notified", "ingesting"]),
          ),
        )
        .limit(1)
      if (inflight.length > 0) return
      const parents = await tx
        .insert(intakeItems)
        .values({
          channel: "crawl",
          connectorId: connector.id,
          tenantId,
          suggestedSiteId: connector.siteId,
          title: `crawl: ${connector.name}`,
          status: "fetching",
          duplicateStatus: "unique",
        })
        .returning({ id: intakeItems.id })
      const parentIntakeItemId = parents[0]?.id
      if (parentIntakeItemId === undefined) throw new IntakeError("INTAKE_CREATE_FAILED")
      await tx.insert(crawlJobs).values({ connectorId: connector.id, parentIntakeItemId, tenantId })
      await sendCrawlJobWithin(tx, { kind: "crawl-dispatch", parentIntakeItemId, tenantId })
    })
  }
}

export const crawlReconcileActionOf = (job: {
  readonly state: "dispatched" | "notified" | "ingesting" | "ingested" | "failed"
  readonly jobId: string | null
  readonly ackedAt: Date | null
  readonly attempts: number
}): "dispatch" | "ingest" | "exhaust" | "skip" => {
  if (job.ackedAt !== null) return "skip"
  if (job.state === "ingested" || job.state === "failed") return job.jobId ? "ingest" : "skip"
  if (job.attempts >= 10) return "exhaust"
  return job.jobId === null ? "dispatch" : "ingest"
}

export const reconcileCrawlJobs = async (db: ServerDb, tenantId: number): Promise<void> => {
  const now = new Date()
  const rows = await db
    .select()
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.tenantId, tenantId),
        or(
          and(
            eq(crawlJobs.state, "dispatched"),
            lt(crawlJobs.updatedAt, new Date(now.getTime() - 30 * 60_000)),
          ),
          and(
            inArray(crawlJobs.state, ["notified", "ingesting"]),
            lt(crawlJobs.updatedAt, new Date(now.getTime() - 10 * 60_000)),
          ),
          and(
            eq(crawlJobs.state, "ingested"),
            isNull(crawlJobs.ackedAt),
            lt(crawlJobs.updatedAt, new Date(now.getTime() - 10 * 60_000)),
          ),
          and(
            eq(crawlJobs.state, "failed"),
            isNull(crawlJobs.ackedAt),
            lt(crawlJobs.updatedAt, new Date(now.getTime() - 10 * 60_000)),
          ),
        ),
      ),
    )
    .limit(20)
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(crawlJobs)
        .where(eq(crawlJobs.id, row.id))
        .for("update")
      if (current === undefined) return
      const action = crawlReconcileActionOf(current)
      if (action === "skip") return
      if (action === "exhaust") {
        await tx
          .update(crawlJobs)
          .set({ state: "failed", lastError: "CRAWL_RECONCILE_EXHAUSTED", updatedAt: now })
          .where(eq(crawlJobs.id, row.id))
        await tx
          .update(intakeItems)
          .set({ status: "failed", failureCode: "CRAWL_RECONCILE_EXHAUSTED", updatedAt: now })
          .where(eq(intakeItems.id, current.parentIntakeItemId))
        return
      }
      await sendCrawlJobWithin(tx, {
        kind: action === "dispatch" ? "crawl-dispatch" : "crawl-ingest",
        parentIntakeItemId: current.parentIntakeItemId,
        tenantId,
        ...(current.jobId === null ? {} : { jobId: current.jobId }),
      })
      await tx
        .update(crawlJobs)
        .set({ attempts: current.attempts + 1, updatedAt: now })
        .where(eq(crawlJobs.id, current.id))
    })
  }
}

export const crawlDispatchInput = async (db: ServerDb, parentId: number, user: unknown) => {
  const tenantId = crawlTenantOf(user)
  const rows = await db
    .select({
      connectorId: connectors.id,
      parentIntakeItemId: crawlJobs.parentIntakeItemId,
      secretReference: connectors.secretReference,
      sourceEndpoint: connectors.sourceEndpoint,
    })
    .from(crawlJobs)
    .innerJoin(connectors, eq(crawlJobs.connectorId, connectors.id))
    .where(
      and(
        eq(crawlJobs.parentIntakeItemId, parentId),
        eq(crawlJobs.tenantId, tenantId),
         isNull(crawlJobs.jobId),
         inArray(crawlJobs.state, ["dispatched", "failed"]),
      ),
    )
    .limit(1)
  const input = rows[0]
  if (input === undefined || input.secretReference === null || input.sourceEndpoint === null) {
    throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
  }
  return { ...input, tenantId }
}

export const recordCrawlDispatch = async (
  db: ServerDb,
  parentId: number,
  jobId: string,
  user: unknown,
): Promise<void> => {
  const tenantId = crawlTenantOf(user)
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(crawlJobs)
      .where(and(eq(crawlJobs.parentIntakeItemId, parentId), eq(crawlJobs.tenantId, tenantId)))
      .for("update")
    if (row === undefined) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
    if (row.jobId === jobId) return
    if (row.jobId !== null) throw new IntakeError("INTAKE_FETCH_STATE_INVALID")
     await tx.update(crawlJobs).set({ jobId, state: "dispatched", lastError: null, updatedAt: new Date() }).where(eq(crawlJobs.id, row.id))
     await tx.update(intakeItems).set({ status: "fetching", failureCode: null, updatedAt: new Date() }).where(eq(intakeItems.id, parentId))
  })
}

export const failCrawlDispatch = async (
  db: ServerDb,
  parentId: number,
  code: string,
  user: unknown,
): Promise<void> => {
  const tenantId = crawlTenantOf(user)
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(crawlJobs)
      .where(and(eq(crawlJobs.parentIntakeItemId, parentId), eq(crawlJobs.tenantId, tenantId)))
      .for("update")
    if (row === undefined) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
    if (row.jobId !== null || row.state !== "dispatched") return
    await tx
      .update(crawlJobs)
      .set({ state: "failed", lastError: code.slice(0, 500), updatedAt: new Date() })
      .where(eq(crawlJobs.id, row.id))
    await tx
      .update(intakeItems)
      .set({ status: "failed", failureCode: code.slice(0, 120), updatedAt: new Date() })
      .where(eq(intakeItems.id, parentId))
  })
}

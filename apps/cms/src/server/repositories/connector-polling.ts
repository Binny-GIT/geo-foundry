/*
 * RSS connector 定时轮询（后台 runtime 每分钟调用）。每个 connector 只维护一条
 * RSS 父稿源；已完成的父项重置为 new，再由稳定的 per-item job 身份去重。
 * lastPolledAt 每次尝试都写入，坏源会退避整个周期。
 */

import { and, desc, eq, isNull, lt, or } from "drizzle-orm"

import { enqueueIntakeFetchFromEnvironment } from "../../services/intake-queue"
import type { ServerDb } from "../db/client"
import { connectors } from "../db/entity-schema"
import { intakeItems } from "../db/session-schema"

/** Hourly cadence per RSS connector; the poll timer itself runs each minute. */
export const RSS_POLL_INTERVAL_MS = 60 * 60 * 1000

export type RssPollReport = {
  readonly errors: readonly { readonly connectorId: number; readonly reason: string }[]
  readonly polled: readonly number[]
  readonly skipped: readonly { readonly connectorId: number; readonly reason: string }[]
}

export const pollDueRssConnectors = async (
  db: ServerDb,
  options: { readonly now?: string } = {},
): Promise<RssPollReport> => {
  const now = new Date(options.now ?? new Date().toISOString())
  const dueBefore = new Date(now.getTime() - RSS_POLL_INTERVAL_MS)
  const due = await db
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.type, "rss"),
        eq(connectors.status, "active"),
        or(isNull(connectors.lastPolledAt), lt(connectors.lastPolledAt, dueBefore)),
      ),
    )
    .limit(20)
  const polled: number[] = []
  const skipped: { connectorId: number; reason: string }[] = []
  const errors: { connectorId: number; reason: string }[] = []
  for (const connector of due) {
    const connectorId = connector.id
    const tenantId = connector.tenantId
    const endpoint = (connector.sourceEndpoint ?? "").trim()
    const markPolled = () =>
      db
        .update(connectors)
        .set({ lastPolledAt: now, updatedAt: new Date() })
        .where(eq(connectors.id, connectorId))
    if (endpoint.length === 0) {
      skipped.push({ connectorId, reason: "RSS_POLL_ENDPOINT_MISSING" })
      await markPolled()
      continue
    }
    try {
      const existing = await db
        .select()
        .from(intakeItems)
        .where(
          and(
            eq(intakeItems.connectorId, connectorId),
            eq(intakeItems.channel, "rss"),
            eq(intakeItems.tenantId, tenantId),
          ),
        )
        .orderBy(desc(intakeItems.createdAt))
        .limit(1)
      let parent = existing[0]
      if (parent === undefined) {
        const inserted = await db
          .insert(intakeItems)
          .values({
            channel: "rss",
            connectorId,
            duplicateStatus: "unique",
            status: "new",
            suggestedSiteId: connector.siteId,
            tenantId,
            title: `RSS: ${connector.name}`,
          })
          .returning()
        parent = inserted[0]
      }
      if (parent === undefined) throw new Error("RSS_POLL_PARENT_INVALID")
      if (parent.status === "fetching") {
        skipped.push({ connectorId, reason: "RSS_POLL_FETCH_IN_FLIGHT" })
        await markPolled()
        continue
      }
      if (
        parent.status === "ignored" ||
        parent.status === "merged" ||
        parent.status === "adopted"
      ) {
        skipped.push({ connectorId, reason: `RSS_POLL_PARENT_${parent.status.toUpperCase()}` })
        await markPolled()
        continue
      }
      await enqueueIntakeFetchFromEnvironment({ intakeItemId: parent.id, tenantId })
      await db
        .update(intakeItems)
        .set({ failureCode: null, failureReason: null, status: "fetching", updatedAt: new Date() })
        .where(eq(intakeItems.id, parent.id))
      polled.push(connectorId)
      await markPolled()
    } catch (error) {
      errors.push({
        connectorId,
        reason: String(error instanceof Error ? error.message : error).slice(0, 200),
      })
      await markPolled().catch(() => undefined)
    }
  }
  return { errors, polled, skipped }
}

/*
 * RSS connector 定时轮询（worker 的每分钟维护任务调用）。每个 connector 只维护
 * 一条进行中的 RSS 父稿源；轮询间隔按 connectors.poll_interval_minutes 逐行生效。
 * lastPolledAt 每次尝试都写入，坏源会退避整个周期。
 *
 * 父稿终态（ignored/merged/adopted）不再跳过——那是人已经处理完这批稿源，
 * 轮询应该开一条新的父稿继续，否则该采集源会永久停摆。
 */

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm"

import { enqueueIntakeFetchFromEnvironment } from "../../services/intake-queue"
import type { ServerDb } from "../db/client"
import { connectors } from "../db/entity-schema"
import { intakeItems } from "../db/session-schema"

export type RssPollReport = {
  readonly errors: readonly { readonly connectorId: number; readonly reason: string }[]
  readonly polled: readonly number[]
  readonly skipped: readonly { readonly connectorId: number; readonly reason: string }[]
}

/** 到期条件按行内的间隔列计算，SQL 侧一次过滤，避免逐行取回再判断。 */
const duePredicate = (now: Date) =>
  or(
    isNull(connectors.lastPolledAt),
    lt(
      connectors.lastPolledAt,
      sql`${now} - make_interval(mins => ${connectors.pollIntervalMinutes})`,
    ),
  )

/** 父稿处置决策（纯函数，便于单测钉住不停摆语义）。 */
export type RssParentAction = "enqueue" | "skip-inflight" | "create-fresh"

export const rssParentActionOf = (parentStatus: string): RssParentAction => {
  if (parentStatus === "fetching") return "skip-inflight"
  if (parentStatus === "ignored" || parentStatus === "merged" || parentStatus === "adopted") {
    return "create-fresh"
  }
  return "enqueue"
}

const insertFreshParent = async (
  db: ServerDb,
  connector: typeof connectors.$inferSelect,
): Promise<typeof intakeItems.$inferSelect> => {
  const inserted = await db
    .insert(intakeItems)
    .values({
      channel: "rss",
      connectorId: connector.id,
      duplicateStatus: "unique",
      status: "new",
      suggestedSiteId: connector.siteId,
      tenantId: connector.tenantId,
      title: `RSS: ${connector.name}`,
    })
    .returning()
  const parent = inserted[0]
  if (parent === undefined) throw new Error("RSS_POLL_PARENT_INVALID")
  return parent
}

export const pollDueRssConnectors = async (
  db: ServerDb,
  options: { readonly now?: string } = {},
): Promise<RssPollReport> => {
  const now = new Date(options.now ?? new Date().toISOString())
  const due = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.type, "rss"), eq(connectors.status, "active"), duePredicate(now)))
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
        parent = await insertFreshParent(db, connector)
      }
      const action = rssParentActionOf(parent.status)
      if (action === "skip-inflight") {
        skipped.push({ connectorId, reason: "RSS_POLL_FETCH_IN_FLIGHT" })
        await markPolled()
        continue
      }
      if (action === "create-fresh") {
        parent = await insertFreshParent(db, connector)
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

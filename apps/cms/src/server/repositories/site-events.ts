/*
 * 站点事件（发布 webhook）投递台账。worker 投递结束（成功或重试耗尽）
 * 回报结果；按 eventId upsert，重复回报收敛到最新一次。failed 行即死信。
 */

import { sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { siteEventDeliveries } from "../db/entity-schema"

export class SiteEventError extends Error {
  override readonly name = "SiteEventError"
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

export type RecordSiteEventDeliveryInput = {
  readonly attemptCount: number
  readonly error: string | null
  readonly eventType: "published" | "updated" | "unpublished"
  readonly eventId: string
  readonly hostname: string | null
  readonly lastStatusCode: number | null
  readonly releaseId: string | null
  readonly siteId: number
  readonly state: "delivered" | "failed"
  readonly tenantId: number
  readonly webhookUrl: string
}

export const recordSiteEventDelivery = async (
  db: ServerDb,
  input: RecordSiteEventDeliveryInput,
): Promise<void> => {
  await db
    .insert(siteEventDeliveries)
    .values({
      attemptCount: input.attemptCount,
      eventType: input.eventType,
      eventId: input.eventId,
      hostname: input.hostname,
      lastError: input.error,
      lastStatusCode: input.lastStatusCode,
      releaseId: input.releaseId,
      siteId: input.siteId,
      state: input.state,
      tenantId: input.tenantId,
      webhookUrl: input.webhookUrl,
    })
    .onConflictDoUpdate({
      cols: [siteEventDeliveries.eventId],
      set: {
        attemptCount: input.attemptCount,
        lastError: input.error,
        lastStatusCode: input.lastStatusCode,
        state: input.state,
        updatedAt: sql`now()`,
      },
    })
}

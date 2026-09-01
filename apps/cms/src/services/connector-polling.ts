import type { Payload } from "payload"

import { createIntakeItem, scheduleIntakeFetch } from "./intake"
import { enqueueIntakeFetchFromEnvironment } from "./intake-queue"

/** Hourly cadence per RSS connector; the poll timer itself runs each minute. */
export const RSS_POLL_INTERVAL_MS = 60 * 60 * 1000

export type RssPollReport = {
  readonly errors: readonly { readonly connectorId: number; readonly reason: string }[]
  readonly polled: readonly number[]
  readonly skipped: readonly { readonly connectorId: number; readonly reason: string }[]
}

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "object" && value !== null) {
    const id = (value as Record<string, unknown>)["id"]
    return typeof id === "number" && Number.isInteger(id) ? id : null
  }
  return null
}

const enqueue: Parameters<typeof scheduleIntakeFetch>[3] = (job) =>
  enqueueIntakeFetchFromEnvironment({ intakeItemId: job.intakeItemId, tenantId: job.tenantId })

/**
 * Finds active RSS connectors whose poll lease expired and re-feeds their feed
 * parent into the intake fetch queue. Each connector keeps exactly one RSS
 * parent intake item; a completed parent is reset to `new` so the stable
 * per-item job identity deduplicates repeated polls. `lastPolledAt` is written
 * on every attempt so a broken source backs off for a full interval.
 */
export const pollDueRssConnectors = async (
  payload: Payload,
  options: { readonly now?: string } = {},
): Promise<RssPollReport> => {
  const now = options.now ?? new Date().toISOString()
  const dueBefore = new Date(Date.parse(now) - RSS_POLL_INTERVAL_MS).toISOString()
  const connectors = await payload.find({
    collection: "connectors",
    depth: 0,
    limit: 20,
    overrideAccess: true,
    where: {
      and: [
        { type: { equals: "rss" } },
        { status: { equals: "active" } },
        {
          or: [{ lastPolledAt: { exists: false } }, { lastPolledAt: { less_than: dueBefore } }],
        },
      ],
    },
  })
  const polled: number[] = []
  const skipped: { connectorId: number; reason: string }[] = []
  const errors: { connectorId: number; reason: string }[] = []
  for (const raw of connectors.docs) {
    const connector = raw as unknown as Record<string, unknown>
    const connectorId = idOf(connector["id"])
    const tenantId = idOf(connector["tenant"])
    if (connectorId === null || tenantId === null) continue
    const endpoint =
      typeof connector["sourceEndpoint"] === "string" ? connector["sourceEndpoint"].trim() : ""
    const markPolled = async () =>
      payload.update({
        collection: "connectors",
        data: { lastPolledAt: now },
        depth: 0,
        id: connectorId,
        overrideAccess: true,
      })
    if (endpoint.length === 0) {
      skipped.push({ connectorId, reason: "RSS_POLL_ENDPOINT_MISSING" })
      await markPolled()
      continue
    }
    try {
      const serviceUsers = await payload.find({
        collection: "users",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: {
          and: [{ role: { equals: "content-service" } }, { tenant: { equals: tenantId } }],
        },
      })
      const actor = serviceUsers.docs[0]
      if (actor === undefined) {
        skipped.push({ connectorId, reason: "RSS_POLL_SERVICE_IDENTITY_MISSING" })
        await markPolled()
        continue
      }
      const existing = await payload.find({
        collection: "intake-items",
        depth: 0,
        draft: true,
        limit: 1,
        overrideAccess: true,
        sort: "-createdAt",
        where: {
          and: [
            { connector: { equals: connectorId } },
            { channel: { equals: "rss" } },
            { tenant: { equals: tenantId } },
          ],
        },
      })
      let parent = existing.docs[0] as Record<string, unknown> | undefined
      if (parent === undefined) {
        const name =
          typeof connector["name"] === "string" ? connector["name"] : `Connector ${connectorId}`
        const created = await createIntakeItem(
          payload,
          { channel: "rss", connectorId, tenantId, title: `RSS: ${name}` },
          actor,
        )
        const duplicateOf = created.duplicates[0] as Record<string, unknown> | undefined
        parent = (duplicateOf ?? created.intakeItem) as Record<string, unknown>
      }
      const parentId = idOf(parent["id"])
      if (parentId === null) throw new Error("RSS_POLL_PARENT_INVALID")
      const status = typeof parent["status"] === "string" ? parent["status"] : ""
      if (status === "fetching") {
        skipped.push({ connectorId, reason: "RSS_POLL_FETCH_IN_FLIGHT" })
        await markPolled()
        continue
      }
      if (status !== "new" && status !== "failed") {
        if (status === "ignored" || status === "merged" || status === "adopted") {
          skipped.push({ connectorId, reason: `RSS_POLL_PARENT_${status.toUpperCase()}` })
          await markPolled()
          continue
        }
        await payload.update({
          collection: "intake-items",
          data: { failureCode: null, failureReason: null, status: "new" },
          depth: 0,
          draft: true,
          id: parentId,
          overrideAccess: true,
        })
      }
      await scheduleIntakeFetch(payload, parentId, actor, enqueue)
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

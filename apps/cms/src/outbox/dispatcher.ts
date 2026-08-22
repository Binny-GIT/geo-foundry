import { readFileSync } from "node:fs"
import { parseQueuePrefix, DEFAULT_QUEUE_PREFIX } from "@geo/domain"
import { Queue } from "bullmq"
import type { Payload } from "payload"

export const OUTBOX_QUEUE_NAME = "outbox"
export const OUTBOX_REDIS_PREFIX = DEFAULT_QUEUE_PREFIX

export const outboxJobIdOf = (eventId: string): string => `outbox-${eventId}`

export type OutboxRedisOptions = {
  readonly db: number
  readonly host: string
  readonly password?: string
  readonly port: number
  readonly username?: string
}

const optionalValue = (
  direct: string | undefined,
  file: string | undefined,
): string | undefined => {
  if (direct !== undefined && direct.length > 0) {
    return direct
  }
  if (file !== undefined && file.length > 0) {
    return readFileSync(file, "utf8").trim()
  }
  return undefined
}

export const parseOutboxRedisOptions = (
  env: Record<string, string | undefined>,
): OutboxRedisOptions => {
  const password = optionalValue(
    env["GEO_FOUNDRY_REDIS_PASSWORD"],
    env["GEO_FOUNDRY_REDIS_PASSWORD_FILE"],
  )
  const username = optionalValue(
    env["GEO_FOUNDRY_REDIS_USERNAME"],
    env["GEO_FOUNDRY_REDIS_USERNAME_FILE"],
  )
  return {
    db: Number(env["GEO_FOUNDRY_REDIS_DATABASE"] ?? "0") || 0,
    host: env["GEO_FOUNDRY_REDIS_HOST"] ?? "127.0.0.1",
    ...(password === undefined ? {} : { password }),
    port: Number(env["GEO_FOUNDRY_REDIS_PORT"] ?? "6379") || 6379,
    ...(username === undefined ? {} : { username }),
  }
}

export const createOutboxQueue = (
  connection: OutboxRedisOptions,
  queuePrefix = parseQueuePrefix(process.env["GEO_FOUNDRY_WORKER_QUEUE_PREFIX"]),
): Queue =>
  new Queue(OUTBOX_QUEUE_NAME, {
    connection,
    prefix: queuePrefix,
  })

export type OutboxDispatchResult = {
  readonly dispatched: number
  readonly examined: number
  readonly failed: number
  readonly jobIds: readonly string[]
}

const OUTBOX_JOB_ATTEMPTS = 5
const OUTBOX_REMOVAL_AGE_SECONDS = 86_400

/**
 * Transactional-outbox dispatcher. Reads pending rows (oldest first) and
 * enqueues one BullMQ job per row using the stable `outbox:<eventId>` jobId.
 *
 * Crash-safety: a row is marked dispatched only after the enqueue succeeded,
 * and re-dispatching the same row re-adds the same jobId, which BullMQ
 * de-duplicates. A Redis outage leaves every row pending with attempts and
 * lastError recorded, so the next run fully recovers.
 */
export const dispatchPendingOutbox = async (
  payload: Payload,
  queue: Queue,
  options: { readonly batchSize?: number } = {},
): Promise<OutboxDispatchResult> => {
  const batchSize = options.batchSize ?? 50
  const pending = await payload.find({
    collection: "outbox-events",
    where: { status: { equals: "pending" } },
    sort: "createdAt",
    limit: batchSize,
    depth: 0,
    overrideAccess: true,
  })
  const jobIds: string[] = []
  let dispatched = 0
  let failed = 0
  for (const row of pending.docs) {
    const jobId = outboxJobIdOf(row.eventId)
    try {
      await queue.add(
        row.type,
        {
          aggregateId: row.aggregateId,
          eventId: row.eventId,
          eventPayload: row.eventPayload,
          operationId: row.operationId,
          tenantId: row.tenant,
        },
        {
          attempts: OUTBOX_JOB_ATTEMPTS,
          jobId,
          removeOnComplete: { age: OUTBOX_REMOVAL_AGE_SECONDS },
          removeOnFail: { age: OUTBOX_REMOVAL_AGE_SECONDS },
        },
      )
      await payload.update({
        collection: "outbox-events",
        id: row.id,
        data: {
          dispatchedAt: new Date().toISOString(),
          status: "dispatched",
        },
        overrideAccess: true,
        depth: 0,
      })
      jobIds.push(jobId)
      dispatched += 1
    } catch (error) {
      await payload.update({
        collection: "outbox-events",
        id: row.id,
        data: {
          attempts: (row.attempts ?? 0) + 1,
          lastError: String(error instanceof Error ? error.message : error).slice(0, 480),
        },
        overrideAccess: true,
        depth: 0,
      })
      failed += 1
    }
  }
  return { dispatched, examined: pending.docs.length, failed, jobIds }
}

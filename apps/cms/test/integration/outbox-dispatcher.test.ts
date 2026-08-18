import type { Queue } from "bullmq"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Site, Tenant, User } from "../../src/payload-types"
import {
  OUTBOX_QUEUE_NAME,
  OUTBOX_REDIS_PREFIX,
  createOutboxQueue,
  dispatchPendingOutbox,
  outboxJobIdOf,
  parseOutboxRedisOptions,
} from "../../src/outbox/dispatcher"
import { transitionEdition } from "../../src/services/edition-workflow"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const validBody = [
  { blockType: "heading" as const, level: "2" as const, text: "Outbox heading" },
  { blockType: "paragraph" as const, text: "Outbox dispatcher paragraph." },
]

const QUEUE_KEY = `${OUTBOX_REDIS_PREFIX}:${OUTBOX_QUEUE_NAME}`

describe("outbox dispatcher integration", () => {
  let payload: Payload
  let tenant: Tenant
  let site: Site
  let bootstrapUser: User
  let tenantAdmin: User
  let editor: User
  let queue: Queue
  let editionSeq = 0
  const editionIds: number[] = []

  const makeEdition = async (): Promise<number> => {
    editionSeq += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: `Outbox dispatcher topic ${editionSeq}`,
        intent: "Prove transactional dispatch",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })
    const edition = await payload.create({
      collection: "content-editions",
      data: {
        angle: `outbox-angle-${editionSeq}`,
        body: validBody,
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "outbox",
        site: site.id,
        summary: "Summary.",
        tenant: tenant.id,
        title: `Outbox edition ${editionSeq}`,
      },
      ...asUser(editor),
    })
    editionIds.push(edition.id)
    return edition.id
  }

  const rowsForEdition = async (editionId: number, status?: string) => {
    const found = await payload.find({
      collection: "outbox-events",
      where: {
        and: [
          { aggregateId: { equals: editionId } },
          ...(status === undefined ? [] : [{ status: { equals: status } }]),
        ],
      },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    return found.docs
  }

  const allJobs = async (): Promise<readonly { id?: string }[]> => {
    const jobs = await queue.getJobs(
      ["wait", "active", "completed", "delayed", "failed", "prioritized", "waiting"],
      0,
      -1,
    )
    return jobs.filter((job) => job.id !== undefined)
  }

  const jobsForEvent = async (eventId: string): Promise<readonly { id?: string }[]> =>
    (await allJobs()).filter((job) => job.id === outboxJobIdOf(eventId))

  const brokenQueue = {
    add: async () => {
      throw new Error("ECONNREFUSED redis outage simulation")
    },
  } as unknown as Queue

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "outbox-events",
      "quality-assessments",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    bootstrapUser = (await payload.create({
      collection: "users",
      data: {
        email: "outbox-boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User
    tenant = await payload.create({
      collection: "tenants",
      data: { name: "outbox-tenant" },
      ...asUser(bootstrapUser),
    })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "outbox-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: {
        email: "outbox-editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: {
        locale: "en-US",
        name: "Outbox Site",
        status: "active",
        tenant: tenant.id,
        timezone: "UTC",
      },
      ...asUser(tenantAdmin),
    })

    queue = createOutboxQueue(parseOutboxRedisOptions(process.env))
    await queue.drain()
    await queue.obliterate({ force: true })
  })

  afterAll(async () => {
    for (const collection of [
      "outbox-events",
      "quality-assessments",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await queue.obliterate({ force: true })
    await queue.close()
    await payload.destroy()
  })

  it("derives the shared Redis connection from the environment", () => {
    const options = parseOutboxRedisOptions({
      GEO_FOUNDRY_REDIS_DATABASE: "0",
      GEO_FOUNDRY_REDIS_HOST: "redis-server",
      GEO_FOUNDRY_REDIS_PASSWORD: "shared-secret",
      GEO_FOUNDRY_REDIS_PORT: "6379",
    })
    expect(options).toEqual({
      db: 0,
      host: "redis-server",
      password: "shared-secret",
      port: 6379,
    })
  })

  it("dispatches one workflow transition to exactly one BullMQ job", async () => {
    const editionId = await makeEdition()
    await transitionEdition(payload, { editionId, target: "generating", user: editor })

    const pending = await rowsForEdition(editionId, "pending")
    expect(pending).toHaveLength(1)
    const row = pending[0]
    if (row === undefined) {
      throw new Error("expected one pending row")
    }
    expect(row.type).toBe("edition.transitioned")
    expect(row.attempts ?? 0).toBe(0)

    const result = await dispatchPendingOutbox(payload, queue)
    expect(result.dispatched).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBe(0)
    expect(result.jobIds).toContain(outboxJobIdOf(row.eventId))

    const jobs = await jobsForEvent(row.eventId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.id).toBe(outboxJobIdOf(row.eventId))

    const stored = await payload.findByID({
      collection: "outbox-events",
      id: row.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(stored.status).toBe("dispatched")
    expect(stored.dispatchedAt).not.toBeNull()
    expect(await rowsForEdition(editionId, "pending")).toHaveLength(0)

    const job = await queue.getJob(outboxJobIdOf(row.eventId))
    if (job === undefined) {
      throw new Error("expected the dispatched job")
    }
    expect(job.name).toBe("edition.transitioned")
    expect((job.data as { aggregateId?: number }).aggregateId).toBe(editionId)
  })

  it("de-duplicates re-dispatches after a crash between enqueue and bookkeeping", async () => {
    const editionId = await makeEdition()
    await transitionEdition(payload, { editionId, target: "generating", user: editor })
    await dispatchPendingOutbox(payload, queue)

    const rows = await rowsForEdition(editionId, "dispatched")
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (row === undefined) {
      throw new Error("expected one dispatched row")
    }

    await payload.update({
      collection: "outbox-events",
      id: row.id,
      data: { status: "pending" },
      overrideAccess: true,
      depth: 0,
    })

    const result = await dispatchPendingOutbox(payload, queue)
    expect(result.dispatched).toBeGreaterThanOrEqual(1)

    const jobs = await jobsForEvent(row.eventId)
    expect(jobs).toHaveLength(1)

    const stored = await payload.findByID({
      collection: "outbox-events",
      id: row.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(stored.status).toBe("dispatched")
  })

  it("keeps rows pending and recoverable when enqueue fails", async () => {
    const editionId = await makeEdition()
    await transitionEdition(payload, { editionId, target: "generating", user: editor })
    const pending = await rowsForEdition(editionId, "pending")
    expect(pending).toHaveLength(1)
    const row = pending[0]
    if (row === undefined) {
      throw new Error("expected one pending row")
    }

    const result = await dispatchPendingOutbox(payload, brokenQueue)
    expect(result.failed).toBeGreaterThanOrEqual(1)

    const stored = await payload.findByID({
      collection: "outbox-events",
      id: row.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(stored.status).toBe("pending")
    expect(stored.attempts).toBe(1)
    expect(String(stored.lastError)).toContain("ECONNREFUSED")

    const recovered = await dispatchPendingOutbox(payload, queue)
    expect(recovered.dispatched).toBeGreaterThanOrEqual(1)
    const jobs = await jobsForEvent(row.eventId)
    expect(jobs).toHaveLength(1)

    const finalRow = await payload.findByID({
      collection: "outbox-events",
      id: row.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(finalRow.status).toBe("dispatched")
    expect(finalRow.attempts).toBe(1)
  })

  it("namespaces queue keys under the geo-foundry prefix", async () => {
    expect(queue.toKey("wait")).toBe(`${QUEUE_KEY}:wait`)
    await queue.add(
      "edition.transitioned",
      { eventId: "prefix-probe", aggregateId: 0 },
      { jobId: outboxJobIdOf("prefix-probe") },
    )
    const probe = await queue.getJob(outboxJobIdOf("prefix-probe"))
    expect(probe?.id).toBe(outboxJobIdOf("prefix-probe"))
    await probe?.remove()
  })
})

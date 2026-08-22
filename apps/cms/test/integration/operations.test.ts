import { getPayload, type Payload, type PayloadRequest } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { operationJobIdOf, parseOperationId } from "@geo/domain"

import config from "../../src/payload.config"
import type { Tenant, User } from "../../src/payload-types"
import { allInternalEndpoints } from "../../src/endpoints/internal/index"
import { resetInternalGuardsForTests } from "../../src/endpoints/internal/guards"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const endpointOf = (path: string, method: "get" | "post") => {
  const endpoint = allInternalEndpoints.find(
    (candidate) => candidate.path === path && candidate.method === method,
  )
  if (endpoint === undefined) {
    throw new Error(`missing endpoint ${method} ${path}`)
  }
  return endpoint.handler
}

const callEndpoint = async (
  path: string,
  method: "get" | "post",
  options: {
    body?: unknown
    headers?: Record<string, string>
    operationId?: string
    payload?: Payload
    user?: unknown
  } = {},
): Promise<Response> => {
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body)
  const req = {
    headers: new Headers(options.headers ?? {}),
    json: async () => (bodyText.length === 0 ? {} : JSON.parse(bodyText)),
    method,
    payload: options.payload,
    routeParams: options.operationId === undefined ? {} : { operationId: options.operationId },
    text: async () => bodyText,
    user: options.user ?? null,
  } as unknown as PayloadRequest
  return endpointOf(path, method)(req)
}

const jsonOf = async (response: Response): Promise<Record<string, unknown>> =>
  JSON.parse(await response.text()) as Record<string, unknown>

const errorCodeOf = async (response: Response): Promise<unknown> =>
  ((await jsonOf(response))["error"] as Record<string, unknown>)["code"]

const operationOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await jsonOf(response))["operation"] as Record<string, unknown>

const submitBody = (overrides: Record<string, unknown> = {}) => ({
  endpoint: "/v1/generate",
  idempotencyKey: "key-0001-abcd",
  operationType: "generate",
  requestPayload: { angle: "technical", topic: "ai-support" },
  ...overrides,
})

describe("operations and idempotency ledger integration", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let bootstrapUser: User
  let tenantAdmin: User
  let serviceUser: User
  let foreignServiceUser: User
  let keySeq = 0

  const nextKey = (): string => {
    keySeq += 1
    return `opkey-${String(keySeq).padStart(6, "0")}-xy`
  }

  const submit = (body: Record<string, unknown>, user: unknown = serviceUser) =>
    callEndpoint("/internal/operations/submit", "post", { body, payload, user })

  beforeAll(async () => {
    resetInternalGuardsForTests()
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "idempotency-records",
      "operations",
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
        email: "ops-boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User
    tenant = await payload.create({
      collection: "tenants",
      data: { name: "ops-tenant" },
      ...asUser(bootstrapUser),
    })
    foreignTenant = await payload.create({
      collection: "tenants",
      data: { name: "ops-foreign-tenant" },
      ...asUser(bootstrapUser),
    })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "ops-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    serviceUser = (await payload.create({
      collection: "users",
      data: {
        email: "ops-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    foreignServiceUser = (await payload.create({
      collection: "users",
      data: {
        email: "ops-foreign-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: foreignTenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
  })

  afterAll(async () => {
    for (const collection of [
      "idempotency-records",
      "operations",
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
    await payload.destroy()
  })

  it("creates an operation with 202 and replays the same body with 200 and the same result", async () => {
    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    expect(created.status).toBe(202)
    const createdBody = await jsonOf(created)
    expect(createdBody["created"]).toBe(true)
    const operation = createdBody["operation"] as Record<string, unknown>
    expect(operation["state"]).toBe("queued")
    expect(operation["attempt"]).toBe(1)
    const operationId = operation["operationId"] as string
    expect(operationId).toHaveLength(36)

    const started = await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "generate-outline" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(started.status).toBe(200)
    const runningOperation = await operationOf(started)
    expect(runningOperation["state"]).toBe("running")
    expect(runningOperation["currentStage"]).toBe("generate-outline")

    const completed = await callEndpoint(
      "/internal/operations/:operationId/stages/complete",
      "post",
      {
        body: {
          attempt: 1,
          outcome: "succeeded",
          result: { editionId: 42 },
          stage: "generate-outline",
        },
        operationId,
        payload,
        user: serviceUser,
      },
    )
    expect(completed.status).toBe(200)
    const done = await operationOf(completed)
    expect(done["state"]).toBe("succeeded")
    expect((done["result"] as Record<string, unknown>)["editionId"]).toBe(42)

    const replay = await submit(submitBody({ idempotencyKey: key }))
    expect(replay.status).toBe(200)
    const replayBody = await jsonOf(replay)
    expect(replayBody["created"]).toBe(false)
    const replayOperation = replayBody["operation"] as Record<string, unknown>
    expect(replayOperation["operationId"]).toBe(operationId)
    expect(replayOperation["state"]).toBe("succeeded")
    expect((replayOperation["result"] as Record<string, unknown>)["editionId"]).toBe(42)

    const count = await payload.count({
      collection: "operations",
      where: { operationId: { equals: operationId } },
      overrideAccess: true,
    })
    expect(count.totalDocs).toBe(1)
  })

  it("rejects a reused idempotency key with a different body", async () => {
    const key = nextKey()
    const first = await submit(submitBody({ idempotencyKey: key }))
    expect(first.status).toBe(202)

    const reused = await submit(
      submitBody({ idempotencyKey: key, requestPayload: { angle: "operations", topic: "other" } }),
    )
    expect(reused.status).toBe(409)
    expect(await errorCodeOf(reused)).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  it("keeps exactly one logical operation under concurrent identical submits", async () => {
    const key = nextKey()
    const results = await Promise.all([
      submit(submitBody({ idempotencyKey: key })),
      submit(submitBody({ idempotencyKey: key })),
      submit(submitBody({ idempotencyKey: key })),
    ])
    const statuses = results.map((response) => response.status).sort()
    expect(statuses.filter((status) => status === 202)).toHaveLength(1)
    expect(statuses.filter((status) => status === 200)).toHaveLength(2)

    const operationIds = new Set(
      await Promise.all(
        results.map(async (response) => (await operationOf(response))["operationId"] as string),
      ),
    )
    expect(operationIds.size).toBe(1)

    const counted = await payload.count({
      collection: "idempotency-records",
      where: { idempotencyKey: { equals: key } },
      overrideAccess: true,
    })
    expect(counted.totalDocs).toBe(1)
  })

  it("keeps terminal operations immutable", async () => {
    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    const operationId = (await operationOf(created))["operationId"] as string
    const startRes = await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "generate-draft" },
      operationId,
      payload,
      user: serviceUser,
    })
    const completeRes = await callEndpoint(
      "/internal/operations/:operationId/stages/complete",
      "post",
      {
        body: {
          attempt: 1,
          outcome: "failed",
          error: { code: "PROVIDER_TIMEOUT" },
          stage: "generate-draft",
        },
        operationId,
        payload,
        user: serviceUser,
      },
    )
    console.log("STEP-start:", startRes.status)
    expect(startRes.status).toBe(200)
    expect(completeRes.status).toBe(200)
    const restart = await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "generate-retry" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(restart.status).toBe(409)
    expect(await errorCodeOf(restart)).toBe("OPERATION_TRANSITION_NOT_ALLOWED")

    const complete = await callEndpoint(
      "/internal/operations/:operationId/stages/complete",
      "post",
      {
        body: { attempt: 1, outcome: "succeeded", result: {}, stage: "generate-retry" },
        operationId,
        payload,
        user: serviceUser,
      },
    )
    expect(complete.status).toBe(409)
    expect(await errorCodeOf(complete)).toBe("OPERATION_TRANSITION_NOT_ALLOWED")

    const cancel = await callEndpoint("/internal/operations/:operationId/cancel", "post", {
      body: { reason: "too late" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(cancel.status).toBe(409)
    expect(await errorCodeOf(cancel)).toBe("OPERATION_TRANSITION_NOT_ALLOWED")

    await expect(
      payload.update({
        collection: "operations",
        id:
          (
            await payload.find({
              collection: "operations",
              where: { operationId: { equals: operationId } },
              limit: 1,
              overrideAccess: true,
            })
          ).docs[0]?.id ?? -1,
        data: { state: "queued", result: { forged: true } },
        ...asUser(serviceUser),
      }),
    ).rejects.toThrow()

    const stored = await payload.find({
      collection: "operations",
      where: { operationId: { equals: operationId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const storedDoc = stored.docs[0] as unknown as { state: string; result: unknown }
    expect(storedDoc.state).toBe("failed")
    expect(storedDoc.result).toBeNull()
  })

  it("rejects completions from a stale attempt", async () => {
    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    const operationId = (await operationOf(created))["operationId"] as string
    await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "evaluate" },
      operationId,
      payload,
      user: serviceUser,
    })

    const stale = await callEndpoint("/internal/operations/:operationId/stages/complete", "post", {
      body: { attempt: 2, outcome: "succeeded", result: {}, stage: "evaluate" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(stale.status).toBe(409)
    expect(await errorCodeOf(stale)).toBe("OPERATION_ATTEMPT_STALE")

    const fresh = await callEndpoint("/internal/operations/:operationId/stages/complete", "post", {
      body: { attempt: 1, outcome: "succeeded", result: { scores: {} }, stage: "evaluate" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(fresh.status).toBe(200)
  })

  it("rejects completion of a cancelled operation", async () => {
    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    const operationId = (await operationOf(created))["operationId"] as string
    await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "generate-draft" },
      operationId,
      payload,
      user: serviceUser,
    })

    const cancelled = await callEndpoint("/internal/operations/:operationId/cancel", "post", {
      body: { reason: "operator aborted" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(cancelled.status).toBe(200)
    expect((await operationOf(cancelled))["state"]).toBe("cancelled")

    const completion = await callEndpoint(
      "/internal/operations/:operationId/stages/complete",
      "post",
      {
        body: { attempt: 1, outcome: "succeeded", result: {}, stage: "generate-draft" },
        operationId,
        payload,
        user: serviceUser,
      },
    )
    expect(completion.status).toBe(409)
    expect(await errorCodeOf(completion)).toBe("OPERATION_TRANSITION_NOT_ALLOWED")
  })

  it("enumerates non-terminal operations as the recovery source after queue loss", async () => {
    const keys = [nextKey(), nextKey(), nextKey()]
    for (const key of keys) {
      await submit(submitBody({ idempotencyKey: key }))
    }
    const finishedKey = keys[0]
    if (finishedKey === undefined) {
      throw new Error("expected seeded recovery keys")
    }
    const finishedId = (
      await operationOf(await submit(submitBody({ idempotencyKey: finishedKey })))
    )["operationId"] as string
    await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "generate-outline" },
      operationId: finishedId,
      payload,
      user: serviceUser,
    })
    await callEndpoint("/internal/operations/:operationId/stages/complete", "post", {
      body: { attempt: 1, outcome: "succeeded", result: {}, stage: "generate-outline" },
      operationId: finishedId,
      payload,
      user: serviceUser,
    })

    const listed = await callEndpoint("/internal/operations/non-terminal", "get", {
      payload,
      user: serviceUser,
    })
    expect(listed.status).toBe(200)
    const body = await jsonOf(listed)
    const operations = body["operations"] as Record<string, unknown>[]
    expect(operations.length).toBeGreaterThanOrEqual(2)
    expect(
      operations.every(
        (operation) => operation["state"] === "queued" || operation["state"] === "running",
      ),
    ).toBe(true)
    const listedIds = new Set(operations.map((operation) => operation["operationId"]))
    expect(listedIds.has(finishedId)).toBe(false)

    const { Queue } = await import("bullmq")
    const queue = new Queue("operations-recovery", {
      connection: {
        host: process.env["GEO_FOUNDRY_REDIS_HOST"] ?? "127.0.0.1",
        password: (await import("node:fs"))
          .readFileSync(
            process.env["GEO_FOUNDRY_REDIS_PASSWORD_FILE"] ??
              "/home/ubuntu/.local/state/geo-foundry-cms/redis-password",
            "utf8",
          )
          .trim(),
        port: Number(process.env["GEO_FOUNDRY_REDIS_PORT"] ?? "6379"),
      },
      prefix: "geo-foundry",
    })
    await queue.drain()
    await queue.obliterate({ force: true })
    try {
      for (const operation of operations) {
        const parsed = parseOperationId(operation["operationId"] as string)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) {
          const jobId = operationJobIdOf(parsed.value, "pipeline")
          await queue.add(
            "operation-recovery",
            { operationId: operation["operationId"] },
            { jobId },
          )
          await queue.add(
            "operation-recovery",
            { operationId: operation["operationId"] },
            { jobId },
          )
        }
      }
      const jobs = await queue.getJobs(["wait", "waiting", "prioritized"], 0, -1)
      expect(jobs.filter((job) => job.id !== undefined)).toHaveLength(operations.length)
    } finally {
      await queue.obliterate({ force: true })
      await queue.close()
    }
  })

  it("returns identical not-found envelopes for foreign operation reads and writes", async () => {
    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    const operationId = (await operationOf(created))["operationId"] as string
    const headers = { "x-request-id": "req-operation-no-leak" }

    const foreignRead = await callEndpoint("/internal/operations/:operationId", "get", {
      headers,
      operationId,
      payload,
      user: foreignServiceUser,
    })
    const unknownRead = await callEndpoint("/internal/operations/:operationId", "get", {
      headers,
      operationId: "11111111-2222-3333-4444-555555555555",
      payload,
      user: serviceUser,
    })
    expect(foreignRead.status).toBe(404)
    expect(await jsonOf(foreignRead)).toEqual(await jsonOf(unknownRead))

    const foreignStart = await callEndpoint(
      "/internal/operations/:operationId/stages/start",
      "post",
      {
        body: { attempt: 1, stage: "generate-draft" },
        headers,
        operationId,
        payload,
        user: foreignServiceUser,
      },
    )
    expect(foreignStart.status).toBe(404)
    expect(await errorCodeOf(foreignStart)).toBe("OPERATION_NOT_FOUND")
  })

  it("answers 404 for unknown operations and 401 for unsigned calls", async () => {
    const unknown = await callEndpoint("/internal/operations/:operationId", "get", {
      operationId: "11111111-2222-3333-4444-555555555555",
      payload,
      user: serviceUser,
    })
    expect(unknown.status).toBe(404)
    expect(await errorCodeOf(unknown)).toBe("OPERATION_NOT_FOUND")

    const unsigned = await callEndpoint("/internal/operations/submit", "post", {
      body: submitBody({ idempotencyKey: nextKey() }),
      payload,
      user: null,
    })
    expect(unsigned.status).toBe(401)
  })

  it("rejects malformed bodies and stages", async () => {
    const badKey = await submit(submitBody({ idempotencyKey: "short" }))
    expect(badKey.status).toBe(400)

    const key = nextKey()
    const created = await submit(submitBody({ idempotencyKey: key }))
    const operationId = (await operationOf(created))["operationId"] as string

    const badStage = await callEndpoint("/internal/operations/:operationId/stages/start", "post", {
      body: { attempt: 1, stage: "Not A Stage" },
      operationId,
      payload,
      user: serviceUser,
    })
    expect(badStage.status).toBe(400)
    expect(await errorCodeOf(badStage)).toBe("INTERNAL_BODY_INVALID")
  })
})

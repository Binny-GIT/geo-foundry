import { getPayload, type Payload, type PayloadRequest } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../src/payload-types"
import { allInternalEndpoints as internalEndpoints } from "../../src/endpoints/internal/index"
import { resetInternalGuardsForTests } from "../../src/endpoints/internal/guards"
import {
  currentEditionInputHash,
  loadWorkflowEdition,
  transitionEdition,
} from "../../src/services/edition-workflow"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const validBody = [
  { blockType: "heading" as const, level: "2" as const, text: "Integration heading" },
  { blockType: "paragraph" as const, text: "Generated paragraph from the content-service." },
]

const endpointOf = (path: string, method: "get" | "post") => {
  const endpoint = internalEndpoints.find(
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
    id?: number
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
    routeParams: { id: String(options.id ?? 0) },
    text: async () => bodyText,
    user: options.user ?? null,
  } as unknown as PayloadRequest
  return endpointOf(path, method)(req)
}

const errorCodeOf = async (response: Response): Promise<unknown> =>
  (
    (JSON.parse(await response.text()) as Record<string, unknown>)["error"] as Record<
      string,
      unknown
    >
  )["code"]

const responseJson = async (response: Response): Promise<Record<string, unknown>> =>
  JSON.parse(await response.text()) as Record<string, unknown>

describe("internal integration endpoints", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let site: Site
  let bootstrapUser: User
  let tenantAdmin: User
  let editor: User
  let reviewer: User
  let publisher: User
  let serviceUser: User
  let foreignServiceUser: User
  let edition: ContentEdition
  let editionSeq = 0

  const call = (
    path: string,
    method: "get" | "post",
    options: Omit<Parameters<typeof callEndpoint>[2], "payload"> = {},
  ) => callEndpoint(path, method, { ...options, payload })

  const makeEdition = async (): Promise<ContentEdition> => {
    editionSeq += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: `Internal integration topic ${editionSeq}`,
        intent: "Exercise the internal integration surface",
        tenant: tenant.id,
        createdBy: "human",
      },
      ...asUser(editor),
    })
    return (await payload.create({
      collection: "content-editions",
      data: {
        angle: `internal-angle-${editionSeq}`,
        body: validBody,
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "integration",
        site: site.id,
        summary: "Summary before generation.",
        tenant: tenant.id,
        title: `Internal edition ${editionSeq}`,
      },
      ...asUser(editor),
    })) as ContentEdition
  }

  const outboxRows = async (type: string, aggregateId?: number) => {
    const found = await payload.find({
      collection: "outbox-events",
      where: {
        and: [
          { type: { equals: type } },
          ...(aggregateId === undefined ? [] : [{ aggregateId: { equals: aggregateId } }]),
        ],
      },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    return found.docs
  }

  beforeAll(async () => {
    resetInternalGuardsForTests()
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
        email: "internal-boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User
    tenant = await payload.create({
      collection: "tenants",
      data: { name: "internal-tenant" },
      ...asUser(bootstrapUser),
    })
    foreignTenant = await payload.create({
      collection: "tenants",
      data: { name: "internal-foreign-tenant" },
      ...asUser(bootstrapUser),
    })
    tenantAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "internal-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    editor = (await payload.create({
      collection: "users",
      data: {
        email: "internal-editor@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    reviewer = (await payload.create({
      collection: "users",
      data: {
        email: "internal-reviewer@geo-foundry.test",
        password: "reviewer-password",
        role: "reviewer",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: {
        email: "internal-publisher@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    serviceUser = (await payload.create({
      collection: "users",
      data: {
        email: "internal-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: tenant.id,
      },
      ...asUser(tenantAdmin),
    })) as User
    foreignServiceUser = (await payload.create({
      collection: "users",
      data: {
        email: "internal-foreign-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: foreignTenant.id,
      },
      ...asUser(bootstrapUser),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: {
        locale: "en-US",
        name: "Internal Site",
        status: "active",
        tenant: tenant.id,
        timezone: "UTC",
      },
      ...asUser(tenantAdmin),
    })
    edition = await makeEdition()
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
    await payload.destroy()
  })

  it("serves the immutable edition input to the service identity", async () => {
    const response = await call("/internal/editions/:id/input", "get", {
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(200)
    const body = await responseJson(response)
    expect(body["editionId"]).toBe(edition.id)
    expect(body["workflowStatus"]).toBe("draft")
    expect(body["inputHash"]).toHaveLength(64)
    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(body["inputHash"]).toBe(currentEditionInputHash(doc))
    expect(response.headers.get("x-request-id")).not.toBeNull()
  })

  it("writes a generated version and commits the outbox event in the same transaction", async () => {
    const response = await call("/internal/editions/:id/versions", "post", {
      body: {
        body: [
          { blockType: "heading", level: "2", text: "Generated heading" },
          { blockType: "paragraph", text: "Generated body from the pipeline." },
        ],
        summary: "Generated summary.",
        title: "Generated title",
      },
      headers: { "x-operation-id": "op-generate-0001", "x-request-id": "req-0001-abcd" },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(200)
    const body = await responseJson(response)
    expect((body["fields"] as string[]).sort()).toEqual(["body", "summary", "title"].sort())
    expect(response.headers.get("x-request-id")).toBe("req-0001-abcd")

    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(doc.title).toBe("Generated title")
    const events = await outboxRows("edition.draft-written", edition.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.operationId).toBe("op-generate-0001")
    expect(events[0]?.requestId).toBe("req-0001-abcd")
    expect(events[0]?.status).toBe("pending")
    expect(Number(events[0]?.tenant)).toBe(Number(tenant.id))
  })

  it("rejects unsigned calls with 401 before any service work", async () => {
    const response = await call("/internal/editions/:id/input", "get", {
      id: edition.id,
      user: null,
    })
    expect(response.status).toBe(401)
    expect(await errorCodeOf(response)).toBe("INTERNAL_UNAUTHENTICATED")
  })

  it("rejects authenticated human roles with 403", async () => {
    const response = await call("/internal/editions/:id/input", "get", {
      id: edition.id,
      user: editor,
    })
    expect(response.status).toBe(403)
    expect(await errorCodeOf(response)).toBe("INTERNAL_FORBIDDEN")
  })

  it("returns the same not-found response for foreign editions and preserves state", async () => {
    const response = await call("/internal/editions/:id/versions", "post", {
      body: { title: "Hostile write" },
      id: edition.id,
      user: foreignServiceUser,
    })
    expect(response.status).toBe(404)
    expect(await responseJson(response)).toMatchObject({
      error: { code: "EDITION_WORKFLOW_NOT_FOUND", message: "edition not found" },
    })
    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(doc.title).toBe("Generated title")
    expect(await outboxRows("edition.draft-written", edition.id)).toHaveLength(1)
  })

  it("rejects malformed bodies with 400 and keeps the edition unchanged", async () => {
    const response = await call("/internal/editions/:id/versions", "post", {
      body: { title: 42 },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(400)
    expect(await errorCodeOf(response)).toBe("INTERNAL_BODY_INVALID")
  })

  it("rolls back both the write and the outbox event when the body fails the collection contract", async () => {
    const eventsBefore = (await outboxRows("edition.draft-written", edition.id)).length
    const response = await call("/internal/editions/:id/versions", "post", {
      body: {
        body: [{ blockType: "embed", provider: "x", title: "broken", url: "not-a-url" }],
        title: "Should never persist",
      },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(500)
    const doc = await loadWorkflowEdition(payload, edition.id)
    expect(doc.title).toBe("Generated title")
    expect(await outboxRows("edition.draft-written", edition.id)).toHaveLength(eventsBefore)
  })

  it("returns identical not-found envelopes for foreign and unknown editions", async () => {
    const headers = { "x-request-id": "req-edition-no-leak" }
    const foreign = await call("/internal/editions/:id/input", "get", {
      headers,
      id: edition.id,
      user: foreignServiceUser,
    })
    const unknown = await call("/internal/editions/:id/input", "get", {
      headers,
      id: 999_999,
      user: serviceUser,
    })

    expect(foreign.status).toBe(404)
    expect(await responseJson(foreign)).toEqual(await responseJson(unknown))
  })

  it("returns identical not-found envelopes for foreign and unknown compile snapshots", async () => {
    const headers = { "x-request-id": "req-snapshot-no-leak" }
    const foreign = await call("/internal/sites/:id/compile-snapshot", "get", {
      headers,
      id: site.id,
      user: foreignServiceUser,
    })
    const unknown = await call("/internal/sites/:id/compile-snapshot", "get", {
      headers,
      id: 999_999,
      user: serviceUser,
    })

    expect(foreign.status).toBe(404)
    expect(await responseJson(foreign)).toEqual(await responseJson(unknown))
  })

  it("records assessments with service identity and commits the outbox event", async () => {
    const doc = await loadWorkflowEdition(payload, edition.id)
    const inputHash = currentEditionInputHash(doc)
    const response = await call("/internal/editions/:id/assessments", "post", {
      body: {
        inputHash,
        issues: [{ code: "MINOR_STYLE", severity: "info" }],
        modelId: "quality-model-v1",
        promptVersion: "2026-08-18",
        provider: "deterministic-test-provider",
        state: "passed",
        thresholdsHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      headers: { "x-operation-id": "op-evaluate-0002" },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(200)
    const body = await responseJson(response)
    expect(body["assessmentId"]).toBeGreaterThan(0)
    const events = await outboxRows("assessment.recorded", edition.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.operationId).toBe("op-evaluate-0002")
  })

  it("records compile results only for approved editions", async () => {
    const response = await call("/internal/editions/:id/compile-results", "post", {
      body: {
        manifestSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        objectCount: 3,
        releaseId: "release-2026-08-18-internal",
        totalBytes: 4096,
      },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(409)
    expect(await errorCodeOf(response)).toBe("EDITION_WORKFLOW_NOT_APPROVED")

    await transitionEdition(payload, { editionId: edition.id, target: "generating", user: editor })
    await transitionEdition(payload, { editionId: edition.id, target: "review", user: editor })
    await transitionEdition(payload, {
      editionId: edition.id,
      target: "approved",
      user: reviewer,
    })

    const approved = await call("/internal/editions/:id/compile-results", "post", {
      body: {
        manifestSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        objectCount: 3,
        releaseId: "release-2026-08-18-internal",
        totalBytes: 4096,
      },
      headers: { "x-operation-id": "op-compile-0003" },
      id: edition.id,
      user: serviceUser,
    })
    expect(approved.status).toBe(200)
    const receipt = await responseJson(approved)
    expect(receipt["releaseId"]).toBe("release-2026-08-18-internal")
    expect(receipt["workflowStatus"]).toBe("approved")

    const events = await outboxRows("edition.compile-recorded", edition.id)
    expect(events).toHaveLength(1)
    const doc = await loadWorkflowEdition(payload, edition.id)
    const audit = Array.isArray(doc.auditLog) ? doc.auditLog : []
    const compileEntry = audit.find(
      (entry) => (entry as { action?: string }).action === "edition.compile.recorded",
    ) as { detail?: { releaseId?: string } } | undefined
    expect(compileEntry?.detail?.releaseId).toBe("release-2026-08-18-internal")
  })

  it("records publish requests only for compiled editions", async () => {
    const response = await call("/internal/editions/:id/publish-requests", "post", {
      body: { reason: "launch window" },
      id: edition.id,
      user: serviceUser,
    })
    expect(response.status).toBe(409)
    expect(await errorCodeOf(response)).toBe("EDITION_WORKFLOW_NOT_COMPILED")

    await transitionEdition(payload, {
      compiledReleaseId: "release-2026-08-18-internal",
      editionId: edition.id,
      target: "compiled",
      user: publisher,
    })

    const compiled = await call("/internal/editions/:id/publish-requests", "post", {
      body: { reason: "launch window" },
      headers: { "x-operation-id": "op-publish-0004" },
      id: edition.id,
      user: serviceUser,
    })
    expect(compiled.status).toBe(200)
    const receipt = await responseJson(compiled)
    expect(receipt["releaseId"]).toBe("release-2026-08-18-internal")
    expect(receipt["workflowStatus"]).toBe("compiled")

    const events = await outboxRows("publish.requested", edition.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.operationId).toBe("op-publish-0004")
  })

  it("keeps every response free of internal secrets", async () => {
    const secrets = [
      process.env["PAYLOAD_SECRET"] ?? "",
      process.env["GEO_FOUNDRY_PG_PASSWORD"] ?? "",
      "service-password",
    ]
    const responses = [
      await call("/internal/editions/:id/input", "get", { id: edition.id, user: serviceUser }),
      await call("/internal/editions/:id/versions", "post", {
        body: { title: 42 },
        id: edition.id,
        user: serviceUser,
      }),
    ]
    for (const response of responses) {
      const text = `${response.url ?? ""} ${await response.text()}`
      for (const secret of secrets) {
        if (secret.length > 0) {
          expect(text.includes(secret)).toBe(false)
        }
      }
    }
  })
})

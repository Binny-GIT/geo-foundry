import { getPayload, type Payload, type PayloadRequest } from "payload"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { allInternalEndpoints } from "../../src/endpoints/internal/index"
import { runOutboxScopedTransaction } from "../../src/outbox/outbox"
import config from "../../src/payload.config"
import type { Release, Site, Tenant, User } from "../../src/payload-types"
import { recordPublishedRelease, recordRollbackReceipt } from "../../src/services/release-registry"
import { createRollbackIntent } from "../../src/services/rollback-intent-approval"
import { consumeRollbackIntent } from "../../src/services/rollback-intents"

const asUser = (user: User) => ({ depth: 0, overrideAccess: false as const, user })
const sha = (character: string): string => character.repeat(64)

const endpointOf = (path: string) => {
  const endpoint = allInternalEndpoints.find(
    (candidate) => candidate.method === "post" && candidate.path === path,
  )
  if (endpoint === undefined) {
    throw new Error(`missing endpoint ${path}`)
  }
  return endpoint.handler
}

const consumeEndpoint = async (
  payload: Payload,
  user: unknown,
  body: Record<string, unknown>,
): Promise<Response> => {
  const bodyText = JSON.stringify(body)
  return endpointOf("/internal/rollback-intents/consume")({
    headers: new Headers(),
    json: async () => JSON.parse(bodyText),
    method: "post",
    payload,
    routeParams: {},
    text: async () => bodyText,
    user,
  } as unknown as PayloadRequest)
}

type ErrorResponseBody = { readonly error: { readonly code: string } }
type ReleaseAudit = { readonly action: string }

const errorCodeOf = async (response: Response): Promise<string> =>
  (JSON.parse(await response.text()) as ErrorResponseBody).error.code

describe("rollback release control-plane integration", () => {
  let payload: Payload
  let tenant: Tenant
  let foreignTenant: Tenant
  let site: Site
  let bootstrap: User
  let publisher: User
  let service: User
  let foreignService: User

  const receiptFor = (releaseId: string, manifestSha256: string, oldEtag: string | null) => ({
    action: "publish" as const,
    actor: { actorId: "publisher-1", kind: "user" as const },
    manifestSha256,
    newEtag: `"etag-${releaseId}"`,
    oldEtag,
    recordedAt: "2026-08-20T09:00:00.000Z",
    releaseId,
    schemaVersion: 1 as const,
    siteId: `site-${site.id}`,
  })

  const releases = async (): Promise<Release[]> => {
    const found = await payload.find({
      collection: "releases",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { site: { equals: site.id } },
    })
    return found.docs as Release[]
  }

  beforeAll(async () => {
    payload = (await getPayload({ config })) as Payload
    for (const collection of [
      "rollback-intents",
      "idempotency-records",
      "operations",
      "releases",
      "outbox-events",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }

    bootstrap = (await payload.create({
      collection: "users",
      data: {
        email: "rollback-bootstrap@geo-foundry.test",
        password: "bootstrap-password-260820",
        role: "editor",
      },
    })) as User
    tenant = await payload.create({
      collection: "tenants",
      data: { name: "rollback-tenant" },
      ...asUser(bootstrap),
    })
    foreignTenant = await payload.create({
      collection: "tenants",
      data: { name: "rollback-foreign-tenant" },
      ...asUser(bootstrap),
    })
    const admin = (await payload.create({
      collection: "users",
      data: {
        email: "rollback-admin@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenant.id,
      },
      ...asUser(bootstrap),
    })) as User
    publisher = (await payload.create({
      collection: "users",
      data: {
        email: "rollback-publisher@geo-foundry.test",
        password: "publisher-password",
        role: "publisher",
        tenant: tenant.id,
      },
      ...asUser(admin),
    })) as User
    service = (await payload.create({
      collection: "users",
      data: {
        email: "rollback-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: tenant.id,
      },
      ...asUser(admin),
    })) as User
    foreignService = (await payload.create({
      collection: "users",
      data: {
        email: "rollback-foreign-service@geo-foundry.test",
        password: "service-password",
        role: "content-service",
        tenant: foreignTenant.id,
      },
      ...asUser(bootstrap),
    })) as User
    site = await payload.create({
      collection: "sites",
      data: {
        locale: "en-US",
        name: "Rollback Site",
        status: "active",
        tenant: tenant.id,
        timezone: "UTC",
      },
      ...asUser(admin),
    })
  })

  afterAll(async () => {
    for (const collection of [
      "rollback-intents",
      "idempotency-records",
      "operations",
      "releases",
      "outbox-events",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    await payload.destroy()
  })

  it("records publishes, then restores a prior immutable release with auditable state transitions", async () => {
    const v1 = receiptFor("release-v1", sha("a"), null)
    const v2 = receiptFor("release-v2", sha("b"), '"etag-release-v1"')
    await recordPublishedRelease(payload, {
      operationId: "publish-v1",
      receipt: v1,
      siteId: site.id,
      user: service,
    })
    await recordPublishedRelease(payload, {
      operationId: "publish-v2",
      receipt: v2,
      siteId: site.id,
      user: service,
    })

    const afterV2 = await releases()
    expect(afterV2.map((release) => [release.releaseId, release.state]).sort()).toEqual([
      ["release-v1", "superseded"],
      ["release-v2", "current"],
    ])

    await recordRollbackReceipt(payload, {
      operationId: "rollback-v2-v1",
      receipt: {
        action: "rollback",
        actor: { actorId: "publisher-1", kind: "user" },
        fromManifestSha256: v2.manifestSha256,
        fromReleaseId: v2.releaseId,
        manifestSha256: v1.manifestSha256,
        newEtag: '"etag-rollback-v1"',
        oldEtag: v2.newEtag,
        recordedAt: "2026-08-20T10:00:00.000Z",
        releaseId: v1.releaseId,
        schemaVersion: 1,
        siteId: v1.siteId,
      },
      user: service,
    })

    const afterRollback = await releases()
    const v1Record = afterRollback.find((release) => release.releaseId === v1.releaseId)
    const v2Record = afterRollback.find((release) => release.releaseId === v2.releaseId)
    expect(v1Record).toBeDefined()
    expect(v2Record).toBeDefined()
    if (v1Record === undefined || v2Record === undefined) {
      throw new Error("rollback release records missing")
    }
    expect(v1Record.state).toBe("current")
    expect(v2Record.state).toBe("rolled_back")
    expect(v1Record.revision).toBe(2)
    expect(v2Record.revision).toBe(1)
    expect((v1Record.auditLog as ReleaseAudit[]).at(-1)?.action).toBe("release.rollback.current")
    expect((v2Record.auditLog as ReleaseAudit[]).at(-1)?.action).toBe("release.current.rolled_back")

    await expect(
      recordPublishedRelease(payload, {
        operationId: "publish-conflict",
        receipt: receiptFor(v1.releaseId, sha("c"), null),
        siteId: site.id,
        user: service,
      }),
    ).rejects.toThrow(/RELEASE_IDENTITY_CONFLICT/)
  })

  it("reconciles the same rollback receipt after a post-CAS database persistence failure", async () => {
    const v1 = receiptFor("release-reconcile-v1", sha("c"), null)
    const v2 = receiptFor("release-reconcile-v2", sha("d"), '"etag-release-reconcile-v1"')
    await recordPublishedRelease(payload, {
      operationId: "publish-reconcile-v1",
      receipt: v1,
      siteId: site.id,
      user: service,
    })
    await recordPublishedRelease(payload, {
      operationId: "publish-reconcile-v2",
      receipt: v2,
      siteId: site.id,
      user: service,
    })
    const receipt = {
      action: "rollback" as const,
      actor: { actorId: "publisher-1", kind: "user" as const },
      fromManifestSha256: v2.manifestSha256,
      fromReleaseId: v2.releaseId,
      manifestSha256: v1.manifestSha256,
      newEtag: '"etag-reconcile-v1"',
      oldEtag: v2.newEtag,
      recordedAt: "2026-08-20T10:30:00.000Z",
      releaseId: v1.releaseId,
      schemaVersion: 1 as const,
      siteId: v1.siteId,
    }
    const originalUpdate = payload.update.bind(payload)
    let releaseUpdates = 0
    const update = vi.spyOn(payload, "update").mockImplementation(async (options) => {
      if (options.collection === "releases") {
        releaseUpdates += 1
        if (releaseUpdates === 2) {
          throw new Error("simulated receipt write failure after CAS")
        }
      }
      return await originalUpdate(options)
    })
    await expect(
      recordRollbackReceipt(payload, {
        operationId: "rollback-reconcile",
        receipt,
        user: service,
      }),
    ).rejects.toThrow(/simulated receipt write failure after CAS/)
    update.mockRestore()

    const beforeReplay = await releases()
    expect(beforeReplay.find((release) => release.releaseId === v1.releaseId)?.state).toBe(
      "superseded",
    )
    expect(beforeReplay.find((release) => release.releaseId === v2.releaseId)?.state).toBe(
      "current",
    )

    await recordRollbackReceipt(payload, {
      operationId: "rollback-reconcile",
      receipt,
      user: service,
    })
    const afterReplay = await releases()
    expect(afterReplay.find((release) => release.releaseId === v1.releaseId)?.state).toBe("current")
    expect(afterReplay.find((release) => release.releaseId === v2.releaseId)?.state).toBe(
      "rolled_back",
    )
  })

  it("freezes publisher approval fields and permits only exact operation replay for consumption", async () => {
    const v1 = receiptFor("release-intent-v1", sha("e"), null)
    const v2 = receiptFor("release-intent-v2", sha("f"), '"etag-release-intent-v1"')
    await recordPublishedRelease(payload, {
      operationId: "publish-intent-v1",
      receipt: v1,
      siteId: site.id,
      user: service,
    })
    await recordPublishedRelease(payload, {
      operationId: "publish-intent-v2",
      receipt: v2,
      siteId: site.id,
      user: service,
    })

    const approved = await createRollbackIntent(payload, {
      expectedCurrentManifestSha256: v2.manifestSha256,
      expectedCurrentReleaseId: v2.releaseId,
      expectedManifestSha256: v1.manifestSha256,
      reason: "restore verified v1",
      siteId: site.id,
      targetReleaseId: v1.releaseId,
      user: publisher,
    })
    const input = {
      expectedCurrentManifestSha256: v2.manifestSha256,
      expectedCurrentReleaseId: v2.releaseId,
      expectedManifestSha256: v1.manifestSha256,
      operationId: approved.operationId,
      rollbackIntentId: approved.intentId,
      runtimeSiteId: approved.runtimeSiteId,
      targetReleaseId: v1.releaseId,
      user: service,
    }
    const stored = await payload.find({
      collection: "rollback-intents",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { intentId: { equals: approved.intentId } },
    })
    expect(stored.docs[0]).toMatchObject({
      expectedCurrentManifestSha256: v2.manifestSha256,
      expectedCurrentReleaseId: v2.releaseId,
      expectedManifestSha256: v1.manifestSha256,
      fromManifestSha256: v2.manifestSha256,
      fromReleaseId: v2.releaseId,
      operationId: approved.operationId,
      reason: "restore verified v1",
      targetReleaseId: v1.releaseId,
    })
    const operations = await payload.find({
      collection: "operations",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { operationId: { equals: approved.operationId } },
    })
    expect(operations.docs[0]).toMatchObject({
      operationType: "rollback",
      requestPayload: { body: { rollbackIntentId: approved.intentId, siteId: approved.runtimeSiteId } },
      state: "queued",
    })
    const outbox = await payload.find({
      collection: "outbox-events",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { operationId: { equals: approved.operationId } },
    })
    expect(outbox.docs[0]).toMatchObject({
      aggregateType: "site",
      type: "rollback.requested",
    })

    await consumeRollbackIntent(payload, input)
    await consumeRollbackIntent(payload, input)
    await expect(
      consumeRollbackIntent(payload, { ...input, operationId: "rollback-op-other" }),
    ).rejects.toThrow(/ROLLBACK_INTENT_MISMATCH/)
    await expect(
      consumeRollbackIntent(payload, { ...input, user: foreignService }),
    ).rejects.toThrow(/ROLLBACK_INTENT_NOT_FOUND/)
  })

  it("maps unapproved internal intent consumption to 404 without persisting a row", async () => {
    const response = await consumeEndpoint(payload, service, {
      expectedCurrentManifestSha256: sha("b"),
      expectedCurrentReleaseId: "release-v2",
      expectedManifestSha256: sha("a"),
      operationId: "rollback-op-missing",
      rollbackIntentId: "11111111-2222-4333-8444-555555555555",
      runtimeSiteId: `site-${site.id}`,
      targetReleaseId: "release-v1",
    })
    expect(response.status).toBe(404)
    expect(await errorCodeOf(response)).toBe("ROLLBACK_INTENT_NOT_FOUND")
  })

  it("rolls back a controlled transaction without leaving a partial release row", async () => {
    const before = await payload.count({ collection: "releases" })
    await expect(
      runOutboxScopedTransaction(payload, async (req) => {
        await payload.create({
          collection: "releases",
          data: {
            auditLog: [],
            manifestSha256: sha("d"),
            releaseId: "release-doomed",
            revision: 0,
            runtimeSiteId: `site-${site.id}`,
            site: site.id,
            state: "uploaded",
            tenant: tenant.id,
          },
          depth: 0,
          overrideAccess: true,
          req,
        })
        throw new Error("simulated receipt persistence interruption")
      }),
    ).rejects.toThrow(/simulated receipt persistence interruption/)
    const after = await payload.count({ collection: "releases" })
    expect(after.totalDocs).toBe(before.totalDocs)
  })
})

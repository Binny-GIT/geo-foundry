import { createHash } from "node:crypto"
import type { Payload } from "payload"
import { resolveSessionClaims } from "../access/session"
import {
  appendOutboxEvent,
  OUTBOX_EVENT,
  runOutboxScopedTransaction,
  type TransactionScope,
} from "../outbox/outbox"

export class RollbackIntentApprovalError extends Error {
  override readonly name = "RollbackIntentApprovalError"

  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

type SiteDoc = { readonly id: number; readonly tenant: unknown }
type ReleaseDoc = {
  readonly manifestSha256: unknown
  readonly releaseId: unknown
  readonly runtimeSiteId: unknown
  readonly site: unknown
  readonly state: unknown
  readonly tenant: unknown
}
type ReleaseStore = {
  create(options: Record<string, unknown>): Promise<unknown>
  find(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
}

const releaseStoreOf = (payload: Payload): ReleaseStore => payload as unknown as ReleaseStore
const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null
const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const releaseOf = async (
  payload: Payload,
  releaseId: string,
  req: TransactionScope,
): Promise<ReleaseDoc | null> => {
  const found = await releaseStoreOf(payload).find({
    collection: "releases",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { releaseId: { equals: releaseId } },
  })
  return (found.docs[0] as ReleaseDoc | undefined) ?? null
}

export type CreateRollbackIntentInput = {
  readonly expectedCurrentManifestSha256: string
  readonly expectedCurrentReleaseId: string
  readonly expectedManifestSha256: string
  readonly reason?: string
  readonly siteId: number
  readonly targetReleaseId: string
  readonly user: unknown
}

export type RollbackIntentApproval = {
  readonly intentId: string
  readonly operationId: string
  readonly runtimeSiteId: string
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

/**
 * Freezes a publisher-approved, tenant-scoped rollback command. The service
 * worker later consumes it exactly once before attempting object-store CAS.
 */
export const createRollbackIntent = async (
  payload: Payload,
  input: CreateRollbackIntentInput,
): Promise<RollbackIntentApproval> => {
  const claims = resolveSessionClaims(input.user)
  if (claims === null || claims.kind !== "user" || claims.role !== "publisher") {
    throw new RollbackIntentApprovalError("ROLLBACK_PUBLISHER_REQUIRED", "publisher role")
  }
  return runOutboxScopedTransaction(payload, async (req) => {
    let site: SiteDoc
    try {
      site = (await payload.findByID({
        collection: "sites",
        depth: 0,
        id: input.siteId,
        overrideAccess: true,
        req,
      })) as unknown as SiteDoc
    } catch {
      throw new RollbackIntentApprovalError("ROLLBACK_SITE_NOT_FOUND", String(input.siteId))
    }
    const tenantId = numberOf(site.tenant)
    if (
      claims.tenantId === null ||
      tenantId === null ||
      String(claims.tenantId) !== String(tenantId)
    ) {
      throw new RollbackIntentApprovalError("ROLLBACK_TENANT_MISMATCH", String(input.siteId))
    }
    const runtimeSiteId = `site-${site.id}`
    const source = await releaseOf(payload, input.expectedCurrentReleaseId, req)
    const target = await releaseOf(payload, input.targetReleaseId, req)
    if (source === null || target === null) {
      throw new RollbackIntentApprovalError("ROLLBACK_RELEASE_NOT_FOUND", input.targetReleaseId)
    }
    const matchesSite = (release: ReleaseDoc): boolean =>
      numberOf(release.site) === site.id &&
      numberOf(release.tenant) === tenantId &&
      textOf(release.runtimeSiteId) === runtimeSiteId
    if (!matchesSite(source) || !matchesSite(target)) {
      throw new RollbackIntentApprovalError("ROLLBACK_RELEASE_SITE_MISMATCH", input.targetReleaseId)
    }
    if (
      source.state !== "current" ||
      textOf(source.manifestSha256) !== input.expectedCurrentManifestSha256 ||
      textOf(target.manifestSha256) !== input.expectedManifestSha256 ||
      source.releaseId === target.releaseId
    ) {
      throw new RollbackIntentApprovalError(
        "ROLLBACK_RELEASE_STATE_MISMATCH",
        input.targetReleaseId,
      )
    }
    const intentId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    const endpoint = `/rollback-intents/${intentId}/execute`
    const idempotencyKey = `rollback-intent-${intentId}`
    const requestPayload = {
      body: {
        expectedCurrentManifestSha256: input.expectedCurrentManifestSha256,
        expectedCurrentReleaseId: input.expectedCurrentReleaseId,
        expectedManifestSha256: input.expectedManifestSha256,
        rollbackIntentId: intentId,
        siteId: runtimeSiteId,
        targetReleaseId: input.targetReleaseId,
      },
    }
    const requestHash = sha256(JSON.stringify(requestPayload))
    const uniqueKey = sha256(`${tenantId}\n${endpoint}\n${idempotencyKey}`)
    await releaseStoreOf(payload).create({
      collection: "rollback-intents",
      data: {
        approvedBy: {
          kind: claims.kind,
          role: claims.role,
          tenantId: claims.tenantId,
          userId: claims.userId,
        },
        expectedCurrentManifestSha256: input.expectedCurrentManifestSha256,
        expectedCurrentReleaseId: input.expectedCurrentReleaseId,
        expectedManifestSha256: input.expectedManifestSha256,
        fromManifestSha256: input.expectedCurrentManifestSha256,
        fromReleaseId: input.expectedCurrentReleaseId,
        intentId,
        operationId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        runtimeSiteId,
        site: site.id,
        targetReleaseId: input.targetReleaseId,
        tenant: tenantId,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    await payload.create({
      collection: "operations",
      data: {
        attempt: 1,
        auditLog: [
          {
            action: "operation.created",
            actor: {
              kind: claims.kind,
              role: claims.role,
              tenantId: claims.tenantId,
              userId: claims.userId,
            },
            at: new Date().toISOString(),
            detail: { endpoint, requestHash },
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
        ],
        endpoint,
        error: null,
        idempotencyKeyHash: sha256(idempotencyKey),
        operationId,
        operationType: "rollback",
        requestPayload,
        revision: 0,
        result: null,
        site: site.id,
        state: "queued",
        targetIds: { siteId: site.id },
        tenant: tenantId,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    await payload.create({
      collection: "idempotency-records",
      data: {
        endpoint,
        idempotencyKey,
        operationId,
        requestHash,
        tenant: tenantId,
        uniqueKey,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    await appendOutboxEvent(
      payload,
      {
        aggregateId: site.id,
        aggregateType: "site",
        eventPayload: requestPayload,
        operationId,
        tenantId,
        type: OUTBOX_EVENT.ROLLBACK_REQUESTED,
      },
      req,
    )
    return { intentId, operationId, runtimeSiteId }
  })
}

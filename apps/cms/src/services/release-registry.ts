import {
  type PublishReceipt,
  PublishReceiptSchema,
  RollbackReceiptSchema,
} from "@geo/schema/release/v1"
import type { Payload } from "payload"

import { runOutboxScopedTransaction, type TransactionScope } from "../outbox/outbox"
import { activatePublishedEditionUrl } from "./edition-url-lifecycle"
import {
  loadWorkflowEdition,
  parseWorkflowStatus,
  requireServiceIdentity,
  transitionEditionWithinTransaction,
} from "./edition-workflow"
import { loadPublishOperationCreator } from "./operations-ledger"
import {
  assertReleaseIdentity,
  assertTenant,
  auditOf,
  numberOf,
  ReleaseRegistryError,
  releaseOf,
  releaseRuntimeSiteId,
  releaseStoreOf,
  type SiteDoc,
  siteOf,
  updateRelease,
} from "./release-registry-support"

export { ReleaseRegistryError } from "./release-registry-support"

export type RecordPublishedReleaseInput = {
  readonly editionId?: number
  readonly operationId: string
  readonly receipt: unknown
  readonly siteId: number
  readonly user: unknown
}

/**
 * Advances an edition from compiled to published inside the same
 * transaction as the release registry write. The actor is recovered from
 * the publish operation's own creation record - never the service identity
 * reporting the receipt - so the domain's publisher-role guard is satisfied
 * by whoever actually authorized this exact release. Requires an exact
 * compiled-release match; an already-published edition under the same
 * release is a no-op replay, anything else fails closed.
 */
const advanceEditionToPublished = async (
  payload: Payload,
  input: {
    readonly editionId: number
    readonly operationId: string
    readonly receipt: PublishReceipt
    readonly site: SiteDoc
  },
  req: TransactionScope,
): Promise<void> => {
  const doc = await loadWorkflowEdition(payload, input.editionId, req, true)
  if (numberOf(doc.site) !== input.site.id) {
    throw new ReleaseRegistryError("RELEASE_EDITION_SITE_MISMATCH", String(input.editionId))
  }
  const status = parseWorkflowStatus(doc.workflowStatus)
  const compiledRelease =
    typeof doc.compiledRelease === "string" && doc.compiledRelease.length > 0
      ? doc.compiledRelease
      : null
  if (status === "published" && compiledRelease === input.receipt.releaseId) {
    return
  }
  if (status !== "compiled" || compiledRelease !== input.receipt.releaseId) {
    throw new ReleaseRegistryError("RELEASE_EDITION_NOT_COMPILED", String(input.editionId))
  }
  const creator = await loadPublishOperationCreator(payload, input.operationId, req)
  if (
    creator.operationType !== "publish" ||
    creator.actor.role !== "publisher" ||
    String(creator.actor.tenantId) !== String(doc.tenant)
  ) {
    throw new ReleaseRegistryError("RELEASE_PUBLISH_AUTHORIZATION_INVALID", input.operationId)
  }
  await transitionEditionWithinTransaction(
    payload,
    {
      editionId: input.editionId,
      operationId: input.operationId,
      target: "published",
      user: {
        id: creator.actor.userId,
        role: creator.actor.role,
        tenant: creator.actor.tenantId ?? undefined,
      },
    },
    req,
  )
}

const markCurrent = async (
  payload: Payload,
  receipt: PublishReceipt,
  input: RecordPublishedReleaseInput,
): Promise<void> => {
  const claims = requireServiceIdentity(input.user)
  await runOutboxScopedTransaction(payload, async (req) => {
    const site = await siteOf(payload, input.siteId, claims, req)
    const runtimeSiteId = releaseRuntimeSiteId(site.id)
    if (receipt.siteId !== runtimeSiteId) {
      throw new ReleaseRegistryError("RELEASE_SITE_MISMATCH", receipt.siteId)
    }
    const current = await releaseStoreOf(payload).find({
      collection: "releases",
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      where: { and: [{ site: { equals: site.id } }, { state: { equals: "current" } }] },
    })
    for (const existing of current.docs as unknown as Awaited<ReturnType<typeof releaseOf>>[]) {
      if (existing !== null && existing.releaseId !== receipt.releaseId) {
        await updateRelease(
          payload,
          existing,
          "superseded",
          auditOf("release.current.superseded", receipt, input.operationId),
          { operationId: input.operationId, receipt },
          req,
        )
      }
    }
    const existing = await releaseOf(payload, receipt.releaseId, req)
    if (existing === null) {
      await releaseStoreOf(payload).create({
        collection: "releases",
        data: {
          auditLog: [auditOf("release.uploaded.current", receipt, input.operationId)],
          manifestSha256: receipt.manifestSha256,
          operationId: input.operationId,
          receipt,
          releaseId: receipt.releaseId,
          revision: 0,
          runtimeSiteId,
          site: site.id,
          state: "current",
          tenant: numberOf(site.tenant) ?? -1,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
    } else {
      assertTenant(claims, existing.tenant)
      assertReleaseIdentity(existing, receipt)
      if (existing.state !== "current") {
        await updateRelease(
          payload,
          existing,
          "current",
          auditOf("release.reconciled.current", receipt, input.operationId),
          { operationId: input.operationId, receipt },
          req,
        )
      }
    }
    if (input.editionId !== undefined) {
      await advanceEditionToPublished(
        payload,
        { editionId: input.editionId, operationId: input.operationId, receipt, site },
        req,
      )
      await activatePublishedEditionUrl(payload, input.editionId, site.id, req)
    }
  })
}

export const recordPublishedRelease = async (
  payload: Payload,
  input: RecordPublishedReleaseInput,
): Promise<void> => markCurrent(payload, PublishReceiptSchema.parse(input.receipt), input)

export type RecordRollbackReceiptInput = {
  readonly operationId: string
  readonly receipt: unknown
  readonly user: unknown
}

export const recordRollbackReceipt = async (
  payload: Payload,
  input: RecordRollbackReceiptInput,
): Promise<void> => {
  const claims = requireServiceIdentity(input.user)
  const receipt = RollbackReceiptSchema.parse(input.receipt)
  await runOutboxScopedTransaction(payload, async (req) => {
    const siteMatch = /^site-(\d+)$/.exec(receipt.siteId)
    if (siteMatch === null) {
      throw new ReleaseRegistryError("RELEASE_RUNTIME_SITE_INVALID", receipt.siteId)
    }
    const site = await siteOf(payload, Number(siteMatch[1]), claims, req)
    const target = await releaseOf(payload, receipt.releaseId, req)
    const source = await releaseOf(payload, receipt.fromReleaseId, req)
    if (target === null || source === null) {
      throw new ReleaseRegistryError("RELEASE_RECONCILIATION_REQUIRED", receipt.releaseId)
    }
    assertTenant(claims, target.tenant)
    assertTenant(claims, source.tenant)
    assertReleaseIdentity(target, receipt)
    if (
      source.releaseId !== receipt.fromReleaseId ||
      source.manifestSha256 !== receipt.fromManifestSha256 ||
      source.runtimeSiteId !== receipt.siteId ||
      numberOf(source.site) !== site.id
    ) {
      throw new ReleaseRegistryError("RELEASE_SOURCE_IDENTITY_CONFLICT", receipt.fromReleaseId)
    }
    if (source.state !== "rolled_back") {
      await updateRelease(
        payload,
        source,
        "rolled_back",
        auditOf("release.current.rolled_back", receipt, input.operationId),
        { operationId: input.operationId, receipt },
        req,
      )
    }
    if (target.state !== "current") {
      await updateRelease(
        payload,
        target,
        "current",
        auditOf("release.rollback.current", receipt, input.operationId),
        { operationId: input.operationId, receipt },
        req,
      )
    }
  })
}

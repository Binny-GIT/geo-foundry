import {
  type PublishReceipt,
  PublishReceiptSchema,
  RollbackReceiptSchema,
} from "@geo/schema/release/v1"
import type { Payload } from "payload"

import { runOutboxScopedTransaction } from "../outbox/outbox"
import { requireServiceIdentity } from "./edition-workflow"
import {
  assertReleaseIdentity,
  assertTenant,
  auditOf,
  numberOf,
  ReleaseRegistryError,
  releaseOf,
  releaseRuntimeSiteId,
  releaseStoreOf,
  siteOf,
  updateRelease,
} from "./release-registry-support"

export { ReleaseRegistryError } from "./release-registry-support"

export type RecordPublishedReleaseInput = {
  readonly operationId: string
  readonly receipt: unknown
  readonly siteId: number
  readonly user: unknown
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
      return
    }
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

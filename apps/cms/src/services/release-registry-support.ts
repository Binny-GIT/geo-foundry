import type { PublishReceipt, RollbackReceipt } from "@geo/schema/release/v1"
import type { Payload } from "payload"

import type { TransactionScope } from "../outbox/outbox"
import type { requireServiceIdentity } from "./edition-workflow"

export class ReleaseRegistryError extends Error {
  override readonly name = "ReleaseRegistryError"

  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

export type ReleaseState = "current" | "rolled_back" | "superseded"

export type ReleaseDoc = {
  readonly auditLog: unknown
  readonly id: number
  readonly manifestSha256: unknown
  readonly releaseId: unknown
  readonly revision: unknown
  readonly runtimeSiteId: unknown
  readonly site: unknown
  readonly state: unknown
  readonly tenant: unknown
}

type SiteDoc = { readonly id: number; readonly tenant: unknown }

type ReleaseStore = {
  create(options: Record<string, unknown>): Promise<unknown>
  find(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
  update(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
}

export const releaseStoreOf = (payload: Payload): ReleaseStore => payload as unknown as ReleaseStore
export const releaseRuntimeSiteId = (siteId: number): string => `site-${siteId}`
export const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

const auditsOf = (doc: ReleaseDoc): readonly Record<string, unknown>[] =>
  Array.isArray(doc.auditLog) ? (doc.auditLog as readonly Record<string, unknown>[]) : []

export const assertTenant = (
  claims: ReturnType<typeof requireServiceIdentity>,
  tenant: unknown,
): number => {
  const tenantId = numberOf(tenant)
  if (
    claims.tenantId === null ||
    tenantId === null ||
    String(claims.tenantId) !== String(tenantId)
  ) {
    throw new ReleaseRegistryError("RELEASE_TENANT_MISMATCH", String(tenant))
  }
  return tenantId
}

export const siteOf = async (
  payload: Payload,
  siteId: number,
  claims: ReturnType<typeof requireServiceIdentity>,
  req: TransactionScope,
): Promise<SiteDoc> => {
  let site: SiteDoc
  try {
    site = (await payload.findByID({
      collection: "sites",
      depth: 0,
      id: siteId,
      overrideAccess: true,
      req,
    })) as unknown as SiteDoc
  } catch {
    throw new ReleaseRegistryError("RELEASE_SITE_NOT_FOUND", String(siteId))
  }
  assertTenant(claims, site.tenant)
  return site
}

export const releaseOf = async (
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

export const updateRelease = async (
  payload: Payload,
  doc: ReleaseDoc,
  state: ReleaseState,
  audit: Record<string, unknown>,
  data: Record<string, unknown>,
  req: TransactionScope,
): Promise<void> => {
  const revision = numberOf(doc.revision) ?? 0
  const updated = await releaseStoreOf(payload).update({
    collection: "releases",
    data: { ...data, auditLog: [...auditsOf(doc), audit], revision: revision + 1, state },
    depth: 0,
    overrideAccess: true,
    req,
    where: { and: [{ id: { equals: doc.id } }, { revision: { equals: revision } }] },
  })
  if (updated.docs.length !== 1) {
    throw new ReleaseRegistryError("RELEASE_REVISION_CONFLICT", String(doc.id))
  }
}

export const assertReleaseIdentity = (
  doc: ReleaseDoc,
  receipt: PublishReceipt | RollbackReceipt,
): void => {
  if (
    doc.releaseId !== receipt.releaseId ||
    doc.manifestSha256 !== receipt.manifestSha256 ||
    doc.runtimeSiteId !== receipt.siteId
  ) {
    throw new ReleaseRegistryError("RELEASE_IDENTITY_CONFLICT", receipt.releaseId)
  }
}

export const auditOf = (
  action: string,
  receipt: PublishReceipt | RollbackReceipt,
  operationId: string,
): Record<string, unknown> => ({ action, at: receipt.recordedAt, operationId, receipt })

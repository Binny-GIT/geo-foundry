/*
 * 发布回执登记的 Drizzle 实现（worker 上传成功 / 回滚成功后调用）。
 * 与旧 services/release-registry.ts 相同的不变量：
 * - release 行 revision CAS，状态 current/superseded/rolled_back；
 * - 文章 compiled→published 由 publish operation 的**创建者**（publisher）执行，
 *   而非上报回执的 content-service；
 * - 已预留 URL 在同一事务内激活。
 */

import {
  type PublishReceipt,
  PublishReceiptSchema,
  type RollbackReceipt,
  RollbackReceiptSchema,
} from "@geo/schema/release/v1"
import { and, eq, sql } from "drizzle-orm"
import { parseUrlId, publishUrl } from "@geo/domain"

import { resolveSessionClaims, type SessionClaims } from "../../access/session"
import { EditionWorkflowError } from "../../services/edition-workflow"
import { buildSiteRegistry, toUrlRecordRow } from "../../services/url-registry-snapshot"
import type { ServerDb } from "../db/client"
import { sites } from "../db/entity-schema"
import { operations } from "../db/ledger-schema"
import { domains, releases } from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import { loadCurrentVersion, transitionEditionWithinTx, workflowActorOf } from "./edition-workflow"

export class ReleaseRegistryError extends Error {
  override readonly name = "ReleaseRegistryError"
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

type Tx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]
type ReleaseRow = typeof releases.$inferSelect
type ReleaseState = "current" | "rolled_back" | "superseded"

export const releaseRuntimeSiteId = (siteId: number): string => `site-${siteId}`

const requireServiceIdentity = (user: unknown): SessionClaims => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw new EditionWorkflowError(
      "EDITION_WORKFLOW_SERVICE_REQUIRED",
      "operation requires the content-service identity",
    )
  }
  return claims
}

const assertTenant = (claims: SessionClaims, tenantId: number | null): number => {
  if (
    claims.tenantId === null ||
    tenantId === null ||
    String(claims.tenantId) !== String(tenantId)
  ) {
    throw new ReleaseRegistryError("RELEASE_TENANT_MISMATCH", String(tenantId))
  }
  return tenantId
}

const siteOf = async (
  tx: Tx,
  siteId: number,
  claims: SessionClaims,
): Promise<{ readonly id: number; readonly tenantId: number }> => {
  const rows = await tx
    .select({ id: sites.id, tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  const site = rows[0]
  if (site === undefined) throw new ReleaseRegistryError("RELEASE_SITE_NOT_FOUND", String(siteId))
  assertTenant(claims, site.tenantId)
  return site
}

const releaseOf = async (tx: Tx, releaseId: string): Promise<ReleaseRow | null> => {
  const rows = await tx.select().from(releases).where(eq(releases.releaseId, releaseId)).limit(1)
  return rows[0] ?? null
}

const auditOf = (
  action: string,
  receipt: PublishReceipt | RollbackReceipt,
  operationId: string,
): Record<string, unknown> => ({ action, at: receipt.recordedAt, operationId, receipt })

const updateRelease = async (
  tx: Tx,
  row: ReleaseRow,
  state: ReleaseState,
  audit: Record<string, unknown>,
  data: { readonly operationId: string; readonly receipt: PublishReceipt | RollbackReceipt },
): Promise<void> => {
  const revision = Number(row.revision ?? 0)
  const existingAudit = Array.isArray(row.auditLog) ? row.auditLog : []
  const updated = await tx
    .update(releases)
    .set({
      auditLog: [...existingAudit, audit],
      operationId: data.operationId,
      receipt: data.receipt,
      revision: String(revision + 1),
      state,
      updatedAt: new Date(),
    })
    .where(and(eq(releases.id, row.id), eq(releases.revision, String(revision))))
    .returning({ id: releases.id })
  if (updated.length !== 1) {
    throw new ReleaseRegistryError("RELEASE_REVISION_CONFLICT", String(row.id))
  }
}

const assertReleaseIdentity = (
  row: ReleaseRow,
  receipt: PublishReceipt | RollbackReceipt,
): void => {
  if (
    row.releaseId !== receipt.releaseId ||
    row.manifestSha256 !== receipt.manifestSha256 ||
    row.runtimeSiteId !== receipt.siteId
  ) {
    throw new ReleaseRegistryError("RELEASE_IDENTITY_CONFLICT", receipt.releaseId)
  }
}

type CreatorActor = { kind: unknown; role: unknown; tenantId: unknown; userId: unknown }

/** 从 operation 审计中恢复最初授权发布的身份（publisher），不是上报回执的服务身份。 */
const loadPublishOperationCreator = async (
  tx: Tx,
  operationId: string,
): Promise<{ readonly actor: CreatorActor; readonly operationType: string }> => {
  const rows = await tx
    .select({ auditLog: operations.auditLog, operationType: operations.operationType })
    .from(operations)
    .where(eq(operations.operationId, operationId))
    .limit(1)
  const row = rows[0]
  if (row === undefined) {
    throw new ReleaseRegistryError("RELEASE_PUBLISH_AUTHORIZATION_INVALID", operationId)
  }
  const entries = Array.isArray(row.auditLog) ? (row.auditLog as Record<string, unknown>[]) : []
  const created = entries.find((entry) => entry["action"] === "operation.created")
  const actor = created?.["actor"]
  if (typeof actor !== "object" || actor === null) {
    throw new ReleaseRegistryError("RELEASE_PUBLISH_AUTHORIZATION_INVALID", operationId)
  }
  return { actor: actor as CreatorActor, operationType: row.operationType }
}

const advanceEditionToPublished = async (
  tx: Tx,
  input: {
    readonly editionId: number
    readonly operationId: string
    readonly receipt: PublishReceipt
    readonly siteId: number
  },
): Promise<void> => {
  const { version } = await loadCurrentVersion(tx, { kind: "global" }, input.editionId)
  if (version.siteId !== input.siteId) {
    throw new ReleaseRegistryError("RELEASE_EDITION_SITE_MISMATCH", String(input.editionId))
  }
  const status = version.workflowStatus ?? "draft"
  const compiledRelease =
    typeof version.compiledRelease === "string" && version.compiledRelease.length > 0
      ? version.compiledRelease
      : null
  if (status === "published" && compiledRelease === input.receipt.releaseId) return
  if (status !== "compiled" || compiledRelease !== input.receipt.releaseId) {
    throw new ReleaseRegistryError("RELEASE_EDITION_NOT_COMPILED", String(input.editionId))
  }
  const creator = await loadPublishOperationCreator(tx, input.operationId)
  const creatorTenant =
    typeof creator.actor.tenantId === "number"
      ? creator.actor.tenantId
      : typeof creator.actor.tenantId === "string"
        ? Number(creator.actor.tenantId)
        : null
  if (
    creator.operationType !== "publish" ||
    creator.actor.role !== "publisher" ||
    String(creatorTenant) !== String(version.tenantId)
  ) {
    throw new ReleaseRegistryError("RELEASE_PUBLISH_AUTHORIZATION_INVALID", input.operationId)
  }
  await transitionEditionWithinTx(tx, {
    actor: workflowActorOf({
      kind: "user",
      role: "publisher",
      tenantId: creatorTenant,
      userId: String(creator.actor.userId),
    }),
    editionId: input.editionId,
    operationId: input.operationId,
    scope:
      creatorTenant === null ? { kind: "global" } : { kind: "tenant", tenantId: creatorTenant },
    target: "published",
  })
}

/** 已预留（reserved）的 URL 在真实发布回执后激活；没有预留行则静默跳过。 */
const activatePublishedEditionUrl = async (
  tx: Tx,
  editionId: number,
  siteId: number,
): Promise<void> => {
  const reserved = await tx
    .select({ id: urlRecords.id, revision: urlRecords.revision })
    .from(urlRecords)
    .where(
      and(
        eq(urlRecords.editionId, editionId),
        eq(urlRecords.siteId, siteId),
        eq(urlRecords.state, "reserved"),
      ),
    )
    .limit(1)
  const url = reserved[0]
  if (url === undefined) return
  const domainRows = await tx
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(
      and(eq(domains.siteId, siteId), eq(domains.role, "canonical"), eq(domains.status, "active")),
    )
    .limit(1)
  const hostname = domainRows[0]?.hostname ?? ""
  if (hostname.length === 0) throw new Error("EDITION_URL_CANONICAL_DOMAIN_MISSING")
  const rows = await tx.select().from(urlRecords).where(eq(urlRecords.siteId, siteId))
  const registry = buildSiteRegistry(
    rows.map((row) =>
      toUrlRecordRow({
        canonicalUrl: row.canonicalUrl,
        content: row.editionId,
        id: row.id,
        locale: row.locale,
        pathname: row.pathname,
        revision: Number(row.revision ?? 0),
        site: row.siteId,
        state: row.state,
        statusCode: row.statusCode === null ? null : Number(row.statusCode),
        targetUrl: row.targetUrlId,
        tenant: row.tenantId,
      }),
    ),
  )
  const urlId = parseUrlId(String(url.id))
  if (!urlId.ok) throw new Error("URL_REGISTRY_INPUT_INVALID")
  const result = publishUrl(registry, {
    expectedRevision: registry.revision,
    hostname,
    urlId: urlId.value,
  })
  if (!result.ok) {
    const error = new Error(result.error.code) as Error & { code?: string }
    error.code = result.error.code
    throw error
  }
  await tx
    .update(urlRecords)
    .set({
      canonicalUrl: result.value.active.canonicalUrl.value,
      revision: sql`${urlRecords.revision} + 1`,
      state: "active",
      updatedAt: new Date(),
    })
    .where(eq(urlRecords.id, url.id))
}

export type RecordPublishedReleaseInput = {
  readonly editionId?: number
  readonly operationId: string
  readonly receipt: unknown
  readonly siteId: number
  readonly user: unknown
}

export const recordPublishedRelease = async (
  db: ServerDb,
  input: RecordPublishedReleaseInput,
): Promise<void> => {
  const receipt = PublishReceiptSchema.parse(input.receipt)
  const claims = requireServiceIdentity(input.user)
  await db.transaction(async (tx) => {
    const site = await siteOf(tx, input.siteId, claims)
    const runtimeSiteId = releaseRuntimeSiteId(site.id)
    if (receipt.siteId !== runtimeSiteId) {
      throw new ReleaseRegistryError("RELEASE_SITE_MISMATCH", receipt.siteId)
    }
    const current = await tx
      .select()
      .from(releases)
      .where(and(eq(releases.siteId, site.id), eq(releases.state, "current")))
      .limit(100)
    for (const existing of current) {
      if (existing.releaseId !== receipt.releaseId) {
        await updateRelease(
          tx,
          existing,
          "superseded",
          auditOf("release.current.superseded", receipt, input.operationId),
          { operationId: input.operationId, receipt },
        )
      }
    }
    const existing = await releaseOf(tx, receipt.releaseId)
    if (existing === null) {
      await tx.insert(releases).values({
        auditLog: [auditOf("release.uploaded.current", receipt, input.operationId)],
        manifestSha256: receipt.manifestSha256,
        operationId: input.operationId,
        receipt,
        releaseId: receipt.releaseId,
        revision: "0",
        runtimeSiteId,
        siteId: site.id,
        state: "current",
        tenantId: site.tenantId,
      })
    } else {
      assertTenant(claims, existing.tenantId)
      assertReleaseIdentity(existing, receipt)
      if (existing.state !== "current") {
        await updateRelease(
          tx,
          existing,
          "current",
          auditOf("release.reconciled.current", receipt, input.operationId),
          { operationId: input.operationId, receipt },
        )
      }
    }
    if (input.editionId !== undefined) {
      await advanceEditionToPublished(tx, {
        editionId: input.editionId,
        operationId: input.operationId,
        receipt,
        siteId: site.id,
      })
      await activatePublishedEditionUrl(tx, input.editionId, site.id)
    }
  })
}

export type RecordRollbackReceiptInput = {
  readonly operationId: string
  readonly receipt: unknown
  readonly user: unknown
}

export const recordRollbackReceipt = async (
  db: ServerDb,
  input: RecordRollbackReceiptInput,
): Promise<void> => {
  const claims = requireServiceIdentity(input.user)
  const receipt = RollbackReceiptSchema.parse(input.receipt)
  await db.transaction(async (tx) => {
    const siteMatch = /^site-(\d+)$/.exec(receipt.siteId)
    if (siteMatch === null) {
      throw new ReleaseRegistryError("RELEASE_RUNTIME_SITE_INVALID", receipt.siteId)
    }
    const site = await siteOf(tx, Number(siteMatch[1]), claims)
    const target = await releaseOf(tx, receipt.releaseId)
    const source = await releaseOf(tx, receipt.fromReleaseId)
    if (target === null || source === null) {
      throw new ReleaseRegistryError("RELEASE_RECONCILIATION_REQUIRED", receipt.releaseId)
    }
    assertTenant(claims, target.tenantId)
    assertTenant(claims, source.tenantId)
    assertReleaseIdentity(target, receipt)
    if (
      source.releaseId !== receipt.fromReleaseId ||
      source.manifestSha256 !== receipt.fromManifestSha256 ||
      source.runtimeSiteId !== receipt.siteId ||
      source.siteId !== site.id
    ) {
      throw new ReleaseRegistryError("RELEASE_SOURCE_IDENTITY_CONFLICT", receipt.fromReleaseId)
    }
    if (source.state !== "rolled_back") {
      await updateRelease(
        tx,
        source,
        "rolled_back",
        auditOf("release.current.rolled_back", receipt, input.operationId),
        { operationId: input.operationId, receipt },
      )
    }
    if (target.state !== "current") {
      await updateRelease(
        tx,
        target,
        "current",
        auditOf("release.rollback.current", receipt, input.operationId),
        { operationId: input.operationId, receipt },
      )
    }
  })
}

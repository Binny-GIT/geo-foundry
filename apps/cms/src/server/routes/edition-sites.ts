/*
 * A4 追加 / 撤下站点（已发布文章的按站操作，不改动文章内容、不影响其他站点）：
 *
 * POST /api/editions/{id}/sites { siteId, reason? }
 *   追加站点：文章版本行加入目标站 → edition_sites 行（pending，曾撤下的复位）
 *   → 预留该站 URL（曾撤下的 gone 行重置回 reserved 复用）→ 同事务入队"仅该站"
 *   的质量评估（站点相关检查锚定新站）。内容没变，不重走编辑审核；评估通过后
 *   由既有的单站发布操作（publish-operations 带 siteId）完成发布。
 *
 * DELETE /api/editions/{id}/sites/{siteId}
 *   撤下站点：
 *   - 该站行已 published → 完整撤下（单事务）：URL active→gone(410) → 行置
 *     unpublished → 版本行移除该站（主站变更时顺延）→ 入队 unpublished 站点
 *     事件（B3 投递链）→ 入队"该站不含此文的新 release"重发操作（worker 编译
 *     该站快照时按 unpublished 行排除本文；两笔回执对 unpublished 行容错）。
 *   - 该站行 pending/failed（从未发布）→ 简单解除分配：删行、删 reserved URL、
 *     版本行移除该站；不发事件、不重发（该站 current release 从不含此文）。
 *
 * 权限与现有发布一致：publisher / super-admin 真人角色，机器身份 403。
 */

import { createHash, randomUUID } from "node:crypto"
import { markUrlGone, parseUrlId } from "@geo/domain"
import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { operationRequestHashOf, operationUniqueKeyOf } from "../../services/operations-ledger"
import { buildSiteRegistry, toUrlRecordRow } from "../../services/url-registry-snapshot"
import { authenticateRequest } from "../auth/session"
import type { ServerDb } from "../db/client"
import { editionSites, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { releases } from "../db/session-schema"
import { urlRecords } from "../db/workflow-schema"
import { IdempotencyConflictError } from "../errors"
import {
  desiredSiteListOf,
  editionSiteRowOf,
  syncEditionSitesWithinTx,
  updateEditionSiteRow,
} from "../repositories/edition-sites"
import {
  insertLatestVersion,
  loadCurrentVersion,
  reserveEditionUrlWithinTx,
  type WorkflowClaims,
} from "../repositories/edition-workflow"
import { type EntityScope, entityScopeOf } from "../repositories/entities"
import { OperationsRepository } from "../repositories/operations"
import { releaseIdForOperation } from "../repositories/publish-operations"
import { enqueueSiteEventWithin } from "../repositories/release-registry"
import { serverRuntime } from "../runtime"

export class EditionSitesError extends Error {
  override readonly name = "EditionSitesError"
  constructor(readonly code: string) {
    super(code)
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorStatusOf = (code: string): number =>
  code === "EDITION_SITE_ADD_SITE_NOT_FOUND" || code === "EDITION_SITE_REMOVE_NOT_ASSIGNED"
    ? 404
    : code.endsWith("TENANT_MISMATCH") ||
        code === "EDITION_WORKFLOW_PUBLISHER_REQUIRED" ||
        code === "EDITION_SITE_ACTOR_INVALID"
      ? 403
      : 409

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

const addSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    siteId: z.number().int().positive(),
  })
  .strict()

export type EditionSitesRoute = "add" | "remove"

export const editionSitesRouteOf = (
  method: string,
  slug: readonly string[] | undefined,
): EditionSitesRoute | null => {
  // catch-all 的 slug 不含 "api" 前缀：/editions/{id}/sites → 长度 3。
  if (method === "POST" && slug?.length === 3 && slug[0] === "editions" && slug[2] === "sites") {
    return "add"
  }
  if (method === "DELETE" && slug?.length === 4 && slug[0] === "editions" && slug[2] === "sites") {
    return "remove"
  }
  return null
}

const idOf = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null

const serializedActor = (claims: WorkflowClaims) => ({
  kind: claims.kind,
  role: claims.role,
  tenantId: claims.tenantId,
  userId: claims.userId,
})

const loadSiteForAdd = async (
  tx: Parameters<Parameters<ServerDb["transaction"]>[0]>[0],
  siteId: number,
) => {
  const rows = await tx
    .select({
      crossDomainBlock: sites.qualityThresholdsCrossDomainBlock,
      crossDomainReview: sites.qualityThresholdsCrossDomainReview,
      dimensionMin: sites.qualityThresholdsDimensionMinimum,
      id: sites.id,
      overallMin: sites.qualityThresholdsOverallMinimum,
      sameSiteTitleBlock: sites.qualityThresholdsSameSiteTitleBlock,
      tenantId: sites.tenantId,
    })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  return rows[0] ?? null
}

const addSite = async (
  db: ServerDb,
  scope: EntityScope,
  claims: WorkflowClaims,
  editionId: number,
  siteId: number,
  reason: string | undefined,
): Promise<{ created: boolean; operationId: string; state: string }> => {
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, editionId)
    const status = version.workflowStatus ?? "draft"
    if (status !== "published") throw new EditionSitesError("EDITION_SITE_ADD_NOT_PUBLISHED")
    const site = await loadSiteForAdd(tx, siteId)
    if (site === null) throw new EditionSitesError("EDITION_SITE_ADD_SITE_NOT_FOUND")
    if (
      version.tenantId !== null &&
      version.tenantId > 0 &&
      site.tenantId !== null &&
      site.tenantId !== version.tenantId
    ) {
      throw new EditionSitesError("EDITION_SITE_ADD_TENANT_MISMATCH")
    }
    const row = await editionSiteRowOf(tx, editionId, siteId)
    if (row !== null && row.publishState === "published") {
      throw new EditionSitesError("EDITION_SITE_ADD_ALREADY_PUBLISHED")
    }
    if (row !== null && (row.publishState === "pending" || row.publishState === "failed")) {
      // 已分配：评估中/评估失败/发布失败都走"等评估 + 单站（重试）发布"，
      // 重复追加只会产生重复评估。
      throw new EditionSitesError("EDITION_SITE_ADD_ALREADY_ASSIGNED")
    }

    // 版本行把新站加入目标集（主站不变；sites[] 保持"主站在前的全集"）。
    const currentDesired = desiredSiteListOf(version)
    let nextSites = currentDesired
    if (!currentDesired.includes(siteId)) {
      nextSites = [...currentDesired, siteId]
      const newVersionId = await insertLatestVersion(tx, version, {
        auditLog: version.auditLog ?? [],
        compiledRelease: version.compiledRelease,
        workflowRevision: version.workflowRevision ?? 0,
        workflowStatus: version.workflowStatus ?? "draft",
      })
      await tx
        .update(editionVersions)
        .set({ sites: nextSites })
        .where(eq(editionVersions.id, newVersionId))
    }
    await syncEditionSitesWithinTx(tx, {
      editionId,
      siteId: nextSites[0] ?? null,
      sites: nextSites.slice(1),
      tenantId: version.tenantId,
    })
    if (row !== null && row.publishState === "unpublished") {
      // 重新追加曾撤下的站：行复位为待评估的 pending（评估结论必须对新周期重跑）。
      await updateEditionSiteRow(tx, {
        editionId,
        patch: {
          publishState: "pending",
          publishedAt: null,
          qualityState: "pending",
          releaseId: null,
          urlRecordId: null,
        },
        siteId,
      })
    }
    // 预留该站 URL：active/reserved 复用；曾撤下的 gone 行重置回 reserved。
    await reserveEditionUrlWithinTx(tx, {
      editionId,
      siteId,
      tenantId: version.tenantId ?? -1,
      title: version.title ?? "",
    })
    const urlRows = await tx
      .select({ revision: urlRecords.revision })
      .from(urlRecords)
      .where(
        and(
          eq(urlRecords.editionId, editionId),
          eq(urlRecords.siteId, siteId),
          inArray(urlRecords.state, ["active", "reserved"]),
        ),
      )
      .limit(1)
    // 追加站点的质量评估只跑新站（A3 按站管线：sites 数组即评估计划），
    // 阈值按该站快照。幂等键含 URL 行修订：每轮追加生命周期（首加/撤下后
    // 重加，URL 行各有一次修订）键不同，撤下后重加不会命中旧评估的重放。
    const revision = Number(urlRows[0]?.revision ?? 0)
    const endpoint = `/editions/${editionId}/sites/${siteId}/evaluate`
    const requestPayload = {
      body: {
        editionId,
        sites: [
          {
            crossDomainBlock: Number(site.crossDomainBlock ?? "0.92"),
            crossDomainReview: Number(site.crossDomainReview ?? "0.85"),
            dimensionMin: Number(site.dimensionMin ?? 75),
            overallMin: Number(site.overallMin ?? 80),
            sameSiteTitleBlock: Number(site.sameSiteTitleBlock ?? "0.9"),
            siteId,
          },
        ],
      },
    }
    const idempotencyKey = `add-site-${editionId}-${siteId}-url-rev-${revision}`
    const requestHash = operationRequestHashOf(requestPayload)
    const outcome = await new OperationsRepository(db).submitWithinTx(tx, {
      auditLog: [
        {
          action: "operation.created",
          actor: serializedActor(claims),
          at: new Date().toISOString(),
          detail: { endpoint, requestHash },
          ...(reason === undefined ? {} : { reason }),
        },
      ],
      endpoint,
      idempotencyKey,
      idempotencyKeyHash: sha256Text(idempotencyKey),
      operationId: randomUUID(),
      operationType: "evaluate",
      requestHash,
      requestPayload,
      siteId,
      targetIds: { editionId },
      tenantId: version.tenantId ?? -1,
      uniqueKey: operationUniqueKeyOf(version.tenantId ?? -1, endpoint, idempotencyKey),
      outbox: {
        aggregateId: editionId,
        eventPayload: requestPayload,
        type: "evaluation.requested",
      },
    })
    return { created: outcome.created, operationId: outcome.operationId, state: outcome.state }
  })
}

const removeSite = async (
  db: ServerDb,
  scope: EntityScope,
  claims: WorkflowClaims,
  editionId: number,
  siteId: number,
  reason: string | undefined,
): Promise<{
  operationId?: string
  operationState?: string
  publishState: "removed" | "unpublished"
  releaseId?: string
}> => {
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, editionId)
    const status = version.workflowStatus ?? "draft"
    if (status !== "published") throw new EditionSitesError("EDITION_SITE_REMOVE_NOT_PUBLISHED")
    const row = await editionSiteRowOf(tx, editionId, siteId)
    if (row === null) throw new EditionSitesError("EDITION_SITE_REMOVE_NOT_ASSIGNED")
    if (row.publishState === "unpublished") {
      throw new EditionSitesError("EDITION_SITE_REMOVE_ALREADY_REMOVED")
    }
    const isTakedown = row.publishState === "published"

    // 版本行移除该站；主站被撤下时顺延到剩余站（无剩余站时保留原主站值）。
    const currentDesired = desiredSiteListOf(version)
    if (currentDesired.includes(siteId)) {
      const nextSites = currentDesired.filter((id) => id !== siteId)
      const nextSiteId =
        version.siteId === siteId ? (nextSites[0] ?? version.siteId) : version.siteId
      const newVersionId = await insertLatestVersion(tx, version, {
        auditLog: version.auditLog ?? [],
        compiledRelease: version.compiledRelease,
        workflowRevision: version.workflowRevision ?? 0,
        workflowStatus: version.workflowStatus ?? "draft",
      })
      await tx
        .update(editionVersions)
        .set({ siteId: nextSiteId, sites: nextSites })
        .where(eq(editionVersions.id, newVersionId))
    }

    const urlRows = await tx
      .select()
      .from(urlRecords)
      .where(and(eq(urlRecords.editionId, editionId), eq(urlRecords.siteId, siteId)))
      .limit(1)
    const urlRow = urlRows[0]
    let removedReleaseId: string | null = null
    if (isTakedown) {
      // 完整撤下：已发布的行必有 active URL（发布回执同事务激活）；
      // 防御性拒绝异常组合，不留"DB 已撤、线上仍可达"的半状态。
      if (urlRow === undefined || urlRow.state !== "active") {
        throw new EditionSitesError("EDITION_SITE_URL_STATE_INVALID")
      }
      const allSiteUrls = await tx.select().from(urlRecords).where(eq(urlRecords.siteId, siteId))
      const registry = buildSiteRegistry(
        allSiteUrls.map((entry) =>
          toUrlRecordRow({
            canonicalUrl: entry.canonicalUrl,
            content: entry.editionId,
            id: entry.id,
            locale: entry.locale,
            pathname: entry.pathname,
            revision: Number(entry.revision ?? 0),
            site: entry.siteId,
            state: entry.state,
            statusCode: entry.statusCode === null ? null : Number(entry.statusCode),
            targetUrl: entry.targetUrlId,
            tenant: entry.tenantId,
          }),
        ),
      )
      const urlId = parseUrlId(String(urlRow.id))
      const goneResult = urlId.ok
        ? markUrlGone(registry, { expectedRevision: registry.revision, urlId: urlId.value })
        : null
      if (!urlId.ok || goneResult === null || !goneResult.ok) {
        throw new EditionSitesError("EDITION_SITE_URL_STATE_INVALID")
      }
      await tx
        .update(urlRecords)
        .set({
          revision: sql`${urlRecords.revision} + 1`,
          state: "gone",
          statusCode: 410,
          updatedAt: new Date(),
        })
        .where(eq(urlRecords.id, urlRow.id))
      removedReleaseId = row.releaseId
      await updateEditionSiteRow(tx, {
        editionId,
        patch: {
          publishState: "unpublished",
          publishedAt: null,
          qualityState: "pending",
          releaseId: null,
          urlRecordId: null,
        },
        siteId,
      })
    } else {
      // 简单解除分配：从未发布的行直接删；reserved URL 一并删（gone 只用于
      // 曾经 active 的 URL）。
      if (urlRow !== undefined && urlRow.state !== "reserved") {
        throw new EditionSitesError("EDITION_SITE_URL_STATE_INVALID")
      }
      if (urlRow !== undefined) {
        await tx.delete(urlRecords).where(eq(urlRecords.id, urlRow.id))
      }
      await tx
        .delete(editionSites)
        .where(and(eq(editionSites.editionId, editionId), eq(editionSites.siteId, siteId)))
    }

    if (!isTakedown) {
      return { publishState: "removed" as const }
    }

    // B3 事件链：unpublished 与撤下同事务入队（站点未配 webhook 时静默跳过）。
    // releaseId 传被撤下的 release：事件 id 按 (站点, release, 类型) 推导，
    // 同一站"撤下→重发→再撤下"各得不同 id，不会被台账去重吞掉。
    const eventSiteRows = await tx
      .select({
        id: sites.id,
        tenantId: sites.tenantId,
        webhookSecretReference: sites.webhookSecretReference,
        webhookUrl: sites.webhookUrl,
      })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    const eventSite = eventSiteRows[0]
    let manifestSha256: string | null = null
    if (removedReleaseId !== null) {
      const releaseRows = await tx
        .select({ manifestSha256: releases.manifestSha256 })
        .from(releases)
        .where(eq(releases.releaseId, removedReleaseId))
        .limit(1)
      manifestSha256 = releaseRows[0]?.manifestSha256 ?? null
    }
    if (eventSite !== undefined) {
      await enqueueSiteEventWithin(tx, eventSite, {
        eventType: "unpublished",
        manifestSha256,
        releaseId: removedReleaseId,
      })
    }

    // 该站"不含此文的新 release"：同事务入队重发操作。worker 编译该站快照
    // 时按 unpublished 行排除本文；编译/发布两笔回执对 unpublished 行容错
    // （只登记 release，不推进文章、不激活 URL）。幂等键含被撤下的 release，
    // 每轮撤下生命周期键不同。
    const requestPayload = { body: { editionId, siteId } }
    const idempotencyKey = `site-takedown-${editionId}-${siteId}-${removedReleaseId ?? "no-release"}`
    const requestHash = operationRequestHashOf(requestPayload)
    const endpoint = `/editions/${editionId}/sites/${siteId}/re-release`
    const outcome = await new OperationsRepository(db).submitWithinTx(tx, {
      auditLog: [
        {
          action: "operation.created",
          actor: serializedActor(claims),
          at: new Date().toISOString(),
          detail: { endpoint, requestHash },
          ...(reason === undefined ? {} : { reason }),
        },
      ],
      endpoint,
      idempotencyKey,
      idempotencyKeyHash: sha256Text(idempotencyKey),
      operationId: randomUUID(),
      operationType: "publish",
      requestHash,
      requestPayload,
      siteId,
      targetIds: { editionId },
      tenantId: version.tenantId ?? -1,
      uniqueKey: operationUniqueKeyOf(version.tenantId ?? -1, endpoint, idempotencyKey),
      outbox: {
        aggregateId: editionId,
        eventPayload: requestPayload,
        type: "publish.requested",
      },
    })
    return {
      operationId: outcome.operationId,
      operationState: outcome.state,
      publishState: "unpublished" as const,
      releaseId: releaseIdForOperation(outcome.operationId),
    }
  })
}

const editionSitesErrorResponse = (error: unknown): Response => {
  if (error instanceof EditionSitesError) {
    return json(errorStatusOf(error.code), { error: { code: error.code } })
  }
  if (error instanceof IdempotencyConflictError) {
    return json(409, { error: { code: "IDEMPOTENCY_KEY_REUSED" } })
  }
  return json(500, { error: { code: "EDITION_SITE_INTERNAL_ERROR" } })
}

export const handleEditionSitesPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (editionSitesRouteOf("POST", slug) !== "add") return null
  const editionId = idOf(slug?.[1])
  if (editionId === null) return json(400, { error: { code: "EDITION_SITE_ID_INVALID" } })
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "EDITION_SITE_BODY_INVALID" } })
  }
  const parsed = addSchema.safeParse(raw)
  if (!parsed.success) return json(400, { error: { code: "EDITION_SITE_BODY_INVALID" } })
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "EDITION_SITE_UNAUTHENTICATED" } })
  // 与发布一致：只允许有发布权限的真人角色，机器身份一律 403。
  if (auth.claims.kind !== "user")
    return json(403, { error: { code: "EDITION_SITE_ACTOR_INVALID" } })
  if (auth.claims.role !== "publisher" && auth.claims.role !== "super-admin") {
    return json(403, { error: { code: "EDITION_WORKFLOW_PUBLISHER_REQUIRED" } })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { error: { code: "EDITION_SITE_ACTOR_INVALID" } })
  try {
    const outcome = await addSite(
      serverRuntime().db,
      scope,
      {
        kind: auth.claims.kind,
        role: auth.claims.role,
        tenantId: auth.claims.tenantId === null ? null : Number(auth.claims.tenantId),
        userId: auth.claims.userId,
      },
      editionId,
      parsed.data.siteId,
      parsed.data.reason,
    )
    return json(outcome.created ? 202 : 200, {
      created: outcome.created,
      editionId,
      operation: {
        operationId: outcome.operationId,
        operationType: "evaluate",
        state: outcome.state,
      },
      siteId: parsed.data.siteId,
    })
  } catch (error) {
    return editionSitesErrorResponse(error)
  }
}

export const handleEditionSitesDelete = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (editionSitesRouteOf("DELETE", slug) !== "remove") return null
  const editionId = idOf(slug?.[1])
  const siteId = idOf(slug?.[3])
  if (editionId === null || siteId === null) {
    return json(400, { error: { code: "EDITION_SITE_ID_INVALID" } })
  }
  let raw: Record<string, unknown> = {}
  try {
    const body: unknown = await request.json()
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      raw = body as Record<string, unknown>
    }
  } catch {
    raw = {}
  }
  const reason =
    typeof raw["reason"] === "string" && raw["reason"].trim().length > 0
      ? raw["reason"].trim()
      : undefined
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "EDITION_SITE_UNAUTHENTICATED" } })
  if (auth.claims.kind !== "user")
    return json(403, { error: { code: "EDITION_SITE_ACTOR_INVALID" } })
  if (auth.claims.role !== "publisher" && auth.claims.role !== "super-admin") {
    return json(403, { error: { code: "EDITION_WORKFLOW_PUBLISHER_REQUIRED" } })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { error: { code: "EDITION_SITE_ACTOR_INVALID" } })
  try {
    const outcome = await removeSite(
      serverRuntime().db,
      scope,
      {
        kind: auth.claims.kind,
        role: auth.claims.role,
        tenantId: auth.claims.tenantId === null ? null : Number(auth.claims.tenantId),
        userId: auth.claims.userId,
      },
      editionId,
      siteId,
      reason,
    )
    return json(outcome.operationId === undefined ? 200 : 202, {
      editionId,
      operation:
        outcome.operationId === undefined
          ? null
          : {
              operationId: outcome.operationId,
              operationType: "publish",
              state: outcome.operationState ?? "queued",
            },
      publishState: outcome.publishState,
      releaseId: outcome.releaseId ?? null,
      siteId,
    })
  } catch (error) {
    return editionSitesErrorResponse(error)
  }
}

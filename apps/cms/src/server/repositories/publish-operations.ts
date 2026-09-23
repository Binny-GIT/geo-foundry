/*
 * 发布意图提交（A2 按站扇出）：approved/compiled 文章 → 每个成员站点一条
 * publish operation（台账、幂等与任务入队同事务，一站一条）。
 * - 不带 siteId：为全部成员站点各提交一条；
 * - 显式 siteId：只为该站提交（定时发布按计划站点、单站失败重试共用此入口，
 *   文章已 published 时仅允许对尚未发布的成员站重试）。
 * 幂等键含站点 ID（publish-edition-{id}-site-{siteId}-...），跨站互不干扰；
 * releaseId 恒由 operationId 确定性推导（releaseIdForOperation），worker 侧重试安全。
 * 会话路由与定时发布调度共用。
 */

import { createHash, randomUUID } from "node:crypto"

import { operationRequestHashOf, operationUniqueKeyOf } from "../../services/operations-ledger"
import type { ServerDb } from "../db/client"
import {
  loadCurrentVersion,
  type WorkflowClaims,
  WorkflowRepositoryError,
} from "./edition-workflow"
import { desiredEditionSiteIdsOf, editionSiteRowOf, memberSiteIdsOf } from "./edition-sites"
import { OperationsRepository } from "./operations"

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

export const releaseIdForOperation = (operationId: string): string =>
  `rel-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`

export type SubmitEditionPublishOutcome = Readonly<{
  created: boolean
  operationId: string
  releaseId: string
  siteId: number
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled"
}>

export const submitEditionPublishOperation = async (
  db: ServerDb,
  input: Readonly<{ claims: WorkflowClaims; editionId: number; reason?: string; siteId?: number }>,
): Promise<SubmitEditionPublishOutcome[]> => {
  const { claims } = input
  const scope =
    claims.tenantId === null
      ? { kind: "global" as const }
      : { kind: "tenant" as const, tenantId: claims.tenantId }
  const { version } = await db.transaction((tx) => loadCurrentVersion(tx, scope, input.editionId))
  if (claims.role !== "publisher" && claims.role !== "super-admin") {
    throw new WorkflowRepositoryError("EDITION_WORKFLOW_PUBLISHER_REQUIRED")
  }
  const status = version.workflowStatus ?? "draft"
  const compiledRelease =
    typeof version.compiledRelease === "string" && version.compiledRelease.length > 0
      ? version.compiledRelease
      : null
  const isPublishedRetry = status === "published" && input.siteId !== undefined
  if (
    status !== "approved" &&
    (status !== "compiled" || compiledRelease === null) &&
    !isPublishedRetry
  ) {
    throw new WorkflowRepositoryError("EDITION_WORKFLOW_NOT_APPROVED")
  }

  const desired = desiredEditionSiteIdsOf({ siteId: version.siteId, sites: version.sites })
  const members = await db.transaction((tx) => memberSiteIdsOf(tx, input.editionId, desired))
  let targetSiteIds: number[]
  if (input.siteId !== undefined) {
    if (!members.includes(input.siteId)) {
      throw new WorkflowRepositoryError("EDITION_WORKFLOW_SITE_NOT_ASSIGNED")
    }
    targetSiteIds = [input.siteId]
    if (isPublishedRetry) {
      // 他站已发布后的单站重试：该站行必须还没发布过，否则会重复出 release。
      const row = await db.transaction((tx) => editionSiteRowOf(tx, input.editionId, input.siteId!))
      if (row !== null && row.publishState === "published") {
        throw new WorkflowRepositoryError("EDITION_WORKFLOW_SITE_ALREADY_PUBLISHED")
      }
    }
  } else {
    targetSiteIds = members
  }
  if (targetSiteIds.length === 0) {
    throw new WorkflowRepositoryError("EDITION_WORKFLOW_SITE_NOT_ASSIGNED")
  }

  const tenantId = claims.tenantId ?? version.tenantId ?? -1
  const endpoint = `/editions/${input.editionId}/publish`
  const revision = Number(version.workflowRevision ?? 0)
  const repository = new OperationsRepository(db)
  const outcomes: SubmitEditionPublishOutcome[] = []
  // 各站在独立事务里提交：某站失败不回滚已提交的站，调用方重放时
  // 已成功站按幂等键原样返回（created=false），失败站继续重试。
  for (const targetSiteId of targetSiteIds) {
    const idempotencyKey =
      compiledRelease === null
        ? `publish-edition-${input.editionId}-site-${targetSiteId}-revision-${revision}`
        : `publish-edition-${input.editionId}-site-${targetSiteId}-${compiledRelease}`
    const requestPayload = { body: { editionId: input.editionId, siteId: targetSiteId } }
    const requestHash = operationRequestHashOf(requestPayload)
    const operationId = randomUUID()
    const outcome = await repository.submit({
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
      idempotencyKey,
      idempotencyKeyHash: sha256Text(idempotencyKey),
      operationId,
      operationType: "publish",
      requestHash,
      requestPayload,
      siteId: targetSiteId,
      targetIds: { editionId: input.editionId },
      tenantId,
      uniqueKey: operationUniqueKeyOf(tenantId, endpoint, idempotencyKey),
      outbox: {
        aggregateId: input.editionId,
        // 队列任务 body（共享契约 operation-job.ts）：worker 按任务里的
        // 站点编译发布，不再从 getEditionInput 取文章单数站点。
        eventPayload: requestPayload,
        type: "publish.requested",
      },
    })
    outcomes.push({
      created: outcome.created,
      operationId: outcome.operationId,
      releaseId: releaseIdForOperation(outcome.operationId),
      siteId: targetSiteId,
      state: outcome.state,
    })
  }
  return outcomes
}

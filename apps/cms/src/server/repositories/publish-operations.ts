/*
 * 发布意图提交：approved/compiled 文章 → publish operation（台账 + 幂等 +
 * publish.requested 事件同事务）。会话路由与定时发布调度共用；
 * 幂等键派生与旧 services/operations-ledger.submitEditionPublishOperation 一致。
 */

import { createHash, randomUUID } from "node:crypto"

import { operationRequestHashOf, operationUniqueKeyOf } from "../../services/operations-ledger"
import type { ServerDb } from "../db/client"
import {
  WorkflowRepositoryError,
  type WorkflowClaims,
  loadCurrentVersion,
} from "./edition-workflow"
import { OperationsRepository } from "./operations"

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

export const releaseIdForOperation = (operationId: string): string =>
  `rel-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`

export type SubmitEditionPublishOutcome = Readonly<{
  created: boolean
  operationId: string
  releaseId: string
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled"
}>

export const submitEditionPublishOperation = async (
  db: ServerDb,
  input: Readonly<{ claims: WorkflowClaims; editionId: number; reason?: string }>,
): Promise<SubmitEditionPublishOutcome> => {
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
  if (status !== "approved" && (status !== "compiled" || compiledRelease === null)) {
    throw new WorkflowRepositoryError("EDITION_WORKFLOW_NOT_APPROVED")
  }
  const tenantId = claims.tenantId ?? version.tenantId ?? -1
  const siteId = version.siteId
  const endpoint = `/editions/${input.editionId}/publish`
  const idempotencyKey =
    compiledRelease === null
      ? `publish-edition-${input.editionId}-revision-${Number(version.workflowRevision ?? 0)}`
      : `publish-edition-${input.editionId}-${compiledRelease}`
  const requestPayload = { body: { editionId: input.editionId } }
  const requestHash = operationRequestHashOf(requestPayload)
  const operationId = randomUUID()
  const outcome = await new OperationsRepository(db).submit({
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
    ...(siteId === null ? {} : { siteId }),
    targetIds: { editionId: input.editionId },
    tenantId,
    uniqueKey: operationUniqueKeyOf(tenantId, endpoint, idempotencyKey),
    outbox: {
      aggregateId: input.editionId,
      eventPayload: {
        editionId: input.editionId,
        operationType: "publish",
        releaseId: compiledRelease ?? releaseIdForOperation(operationId),
        ...(siteId === null ? {} : { siteId }),
      },
      type: "publish.requested",
    },
  })
  return {
    created: outcome.created,
    operationId: outcome.operationId,
    releaseId: compiledRelease ?? releaseIdForOperation(outcome.operationId),
    state: outcome.state,
  }
}

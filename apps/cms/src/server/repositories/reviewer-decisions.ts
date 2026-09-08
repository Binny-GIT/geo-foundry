/*
 * 审核决策仓储：同步完成 transition + request-changes 评论 + 幂等重放，
 * 全部在一个事务内；advisory lock 仲裁跨实例并发。
 */

import { createHash, randomUUID } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { canonicalize } from "../../services/edition-input-hash"
import { operationRequestHashOf, operationUniqueKeyOf } from "../../services/operations-ledger"
import type { ServerDb } from "../db/client"
import { editionVersions } from "../db/edition-schema"
import { reviewComments, reviewerDecisionIdempotency } from "../db/workflow-schema"
import type { EntityScope } from "./entities"
import {
  transitionEditionWithinTx,
  workflowActorOf,
  type WorkflowClaims,
  WorkflowRepositoryError,
} from "./edition-workflow"

export type ReviewerDecisionTarget = "approved" | "draft"

export type ReviewerDecisionInput = Readonly<{
  claims: WorkflowClaims
  editionId: number
  expectedRevision: number
  idempotencyKey: string
  reason?: string
  requestId: string
  scope: EntityScope
  target: ReviewerDecisionTarget
}>

export type ReviewerDecisionResponse = Readonly<{
  editionId: number
  workflowRevision: number
  workflowStatus: ReviewerDecisionTarget
}>

export class ReviewerDecisionRepositoryError extends Error {
  override readonly name = "ReviewerDecisionRepositoryError"
  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): ReviewerDecisionRepositoryError =>
  new ReviewerDecisionRepositoryError(code)

const idempotencyKeyHashOf = (key: string): string => createHash("sha256").update(key).digest("hex")

const endpointOf = (input: ReviewerDecisionInput): string =>
  `/workspaces/reviewer/editions/${input.editionId}/${
    input.target === "approved" ? "approve" : "request-changes"
  }`

const responseOf = (value: unknown): ReviewerDecisionResponse => {
  const row = value as Partial<ReviewerDecisionResponse> | null
  if (
    row === null ||
    typeof row.editionId !== "number" ||
    typeof row.workflowRevision !== "number" ||
    (row.workflowStatus !== "approved" && row.workflowStatus !== "draft")
  ) {
    throw fail("REVIEWER_EDITION_IDEMPOTENCY_INVALID")
  }
  return {
    editionId: row.editionId,
    workflowRevision: row.workflowRevision,
    workflowStatus: row.workflowStatus,
  }
}

export class ReviewerDecisionsRepository {
  constructor(private readonly db: ServerDb) {}

  /**
   * super-admin（claims.tenantId=null）的幂等分区跟随文章租户，
   * 与所属租户 reviewer 的重放落到同一 unique key。
   */
  private async decisionTenantOf(input: ReviewerDecisionInput): Promise<number> {
    if (input.claims.tenantId !== null) return input.claims.tenantId
    const rows = await this.db
      .select({ tenantId: editionVersions.tenantId })
      .from(editionVersions)
      .where(and(eq(editionVersions.parentId, input.editionId), eq(editionVersions.latest, true)))
      .limit(1)
    return rows[0]?.tenantId ?? -1
  }

  async submit(input: ReviewerDecisionInput): Promise<{
    created: boolean
    response: ReviewerDecisionResponse
  }> {
    const tenantId = await this.decisionTenantOf(input)
    const endpoint = endpointOf(input)
    const requestHash = operationRequestHashOf(
      canonicalize({
        editionId: input.editionId,
        expectedRevision: input.expectedRevision,
        target: input.target,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    )
    const uniqueKey = operationUniqueKeyOf(tenantId, endpoint, input.idempotencyKey)
    const decisionId = randomUUID()

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${uniqueKey}))`)
      const existingRows = await tx
        .select({
          requestHash: reviewerDecisionIdempotency.requestHash,
          responsePayload: reviewerDecisionIdempotency.responsePayload,
        })
        .from(reviewerDecisionIdempotency)
        .where(eq(reviewerDecisionIdempotency.uniqueKey, uniqueKey))
        .limit(1)
      const existing = existingRows[0]
      if (existing !== undefined) {
        if (existing.requestHash !== requestHash) throw fail("IDEMPOTENCY_KEY_REUSED")
        await tx
          .update(reviewerDecisionIdempotency)
          .set({
            replayCount: sql`COALESCE(${reviewerDecisionIdempotency.replayCount}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(eq(reviewerDecisionIdempotency.uniqueKey, uniqueKey))
        return { created: false, response: responseOf(existing.responsePayload) }
      }

      const actor = workflowActorOf(input.claims)
      const status = await transitionEditionWithinTx(tx, {
        actor,
        decisionId,
        editionId: input.editionId,
        expectedRevision: input.expectedRevision,
        idempotencyKeyHash: idempotencyKeyHashOf(input.idempotencyKey),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        requestId: input.requestId,
        scope: input.scope,
        target: input.target,
      })
      if (status !== input.target) {
        throw new WorkflowRepositoryError("REVIEWER_EDITION_STATE_INVALID")
      }
      if (input.target === "draft") {
        await tx.insert(reviewComments).values({
          authorId: Number(input.claims.userId),
          body: input.reason ?? "",
          editionId: input.editionId,
          kind: "request-changes",
          tenantId,
          workflowRevision: String(input.expectedRevision + 1),
        })
      }
      const response: ReviewerDecisionResponse = {
        editionId: input.editionId,
        workflowRevision: input.expectedRevision + 1,
        workflowStatus: input.target,
      }
      await tx.insert(reviewerDecisionIdempotency).values({
        actorUserId: input.claims.userId,
        decisionId,
        editionId: input.editionId,
        endpoint,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        requestId: input.requestId,
        responsePayload: response,
        tenantId,
        uniqueKey,
      })
      return { created: true, response }
    })
  }
}

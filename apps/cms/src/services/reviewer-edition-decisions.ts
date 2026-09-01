import { createHash } from "node:crypto"

import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { runOutboxScopedTransaction, type TransactionScope } from "../outbox/outbox"
import { canonicalize } from "./edition-input-hash"
import {
  assertEditionTenantScope,
  EditionWorkflowError,
  loadWorkflowEdition,
  parseWorkflowStatus,
  transitionEditionWithinTransaction,
} from "./edition-workflow"
import { operationRequestHashOf, operationUniqueKeyOf } from "./operations-ledger"
import { createReviewComment } from "./review-comments"

export class ReviewerEditionDecisionError extends Error {
  override readonly name = "ReviewerEditionDecisionError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail: string): ReviewerEditionDecisionError =>
  new ReviewerEditionDecisionError(code, detail)

const numberField = (value: unknown): number | null => (typeof value === "number" ? value : null)

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === "23505") return true
  return (
    typeof candidate.message === "string" &&
    (candidate.message.includes("duplicate key value violates unique constraint") ||
      candidate.message.includes("field is invalid: uniqueKey"))
  )
}

export type ReviewerDecisionTarget = "approved" | "draft"

export type ReviewerEditionDecisionInput = {
  readonly editionId: number
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly requestId: string
  readonly reason?: string
  readonly target: ReviewerDecisionTarget
  readonly user: unknown
}

export type ReviewerEditionDecisionResponse = {
  readonly editionId: number
  readonly workflowRevision: number
  readonly workflowStatus: ReviewerDecisionTarget
}

export type ReviewerEditionDecisionOutcome = {
  readonly created: boolean
  readonly response: ReviewerEditionDecisionResponse
}

type DecisionIdempotencyDoc = {
  readonly id: number
  readonly requestHash: string
  readonly replayCount: unknown
  readonly responsePayload: unknown
}

const endpointOf = (input: ReviewerEditionDecisionInput): string =>
  `/workspaces/reviewer/editions/${input.editionId}/${
    input.target === "approved" ? "approve" : "request-changes"
  }`

const loadByUniqueKey = async (
  payload: Payload,
  uniqueKey: string,
  req: TransactionScope = {},
): Promise<DecisionIdempotencyDoc | null> => {
  const found = await payload.find({
    collection: "reviewer-edition-decision-idempotency",
    where: { uniqueKey: { equals: uniqueKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return (found.docs[0] as unknown as DecisionIdempotencyDoc | undefined) ?? null
}

const responseOf = (value: unknown): ReviewerEditionDecisionResponse => {
  const row = value as Record<string, unknown> | null
  const editionId = numberField(row?.["editionId"])
  const workflowRevision = numberField(row?.["workflowRevision"])
  const workflowStatus = row?.["workflowStatus"]
  if (
    editionId === null ||
    workflowRevision === null ||
    (workflowStatus !== "approved" && workflowStatus !== "draft")
  ) {
    throw fail("REVIEWER_EDITION_IDEMPOTENCY_INVALID", "stored response is invalid")
  }
  return { editionId, workflowRevision, workflowStatus }
}

const replay = async (
  payload: Payload,
  record: DecisionIdempotencyDoc,
): Promise<ReviewerEditionDecisionOutcome> => {
  await payload.update({
    collection: "reviewer-edition-decision-idempotency",
    id: record.id,
    data: { replayCount: (numberField(record.replayCount) ?? 0) + 1 },
    depth: 0,
    overrideAccess: true,
  })
  return { created: false, response: responseOf(record.responsePayload) }
}

const reviewerClaimsOf = (user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null) {
    throw fail("REVIEWER_EDITION_ACTOR_INVALID", "session has no valid claims")
  }
  if (claims.kind !== "user" || claims.role !== "reviewer" || claims.tenantId === null) {
    throw fail("REVIEWER_EDITION_REVIEWER_REQUIRED", "reviewer identity is required")
  }
  const tenantId = Number(claims.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw fail("REVIEWER_EDITION_ACTOR_INVALID", "reviewer tenant is invalid")
  }
  return { claims, tenantId }
}

const decisionRequestOf = (input: ReviewerEditionDecisionInput): Record<string, unknown> => ({
  editionId: input.editionId,
  expectedRevision: input.expectedRevision,
  target: input.target,
  ...(input.reason === undefined ? {} : { reason: input.reason }),
})

const idempotencyKeyHashOf = (key: string): string => createHash("sha256").update(key).digest("hex")

/**
 * Synchronous, tenant-scoped reviewer transition with exact replay. A stored
 * decision response is replayed without evaluating quality, appending audit,
 * or emitting another outbox event.
 */
export async function submitReviewerEditionDecision(
  payload: Payload,
  input: ReviewerEditionDecisionInput,
): Promise<ReviewerEditionDecisionOutcome> {
  const { tenantId } = reviewerClaimsOf(input.user)
  const endpoint = endpointOf(input)
  const requestHash = operationRequestHashOf(canonicalize(decisionRequestOf(input)))
  const uniqueKey = operationUniqueKeyOf(tenantId, endpoint, input.idempotencyKey)

  const existing = await loadByUniqueKey(payload, uniqueKey)
  if (existing !== null) {
    if (existing.requestHash !== requestHash) {
      throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different request")
    }
    return replay(payload, existing)
  }

  try {
    return await runOutboxScopedTransaction(payload, async (req) => {
      const raced = await loadByUniqueKey(payload, uniqueKey, req)
      if (raced !== null) {
        if (raced.requestHash !== requestHash) {
          throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different request")
        }
        return { created: false, response: responseOf(raced.responsePayload) }
      }

      const doc = await loadWorkflowEdition(payload, input.editionId, req, true)
      assertEditionTenantScope(input.user, doc)
      const currentRevision = numberField(doc.workflowRevision)
      if (currentRevision === null || currentRevision !== input.expectedRevision) {
        throw new EditionWorkflowError(
          "EDITION_WORKFLOW_REVISION_CONFLICT",
          `edition ${input.editionId}`,
        )
      }

      const decisionId = crypto.randomUUID()
      const state = await transitionEditionWithinTransaction(
        payload,
        {
          decisionId,
          editionId: input.editionId,
          expectedRevision: input.expectedRevision,
          idempotencyKeyHash: idempotencyKeyHashOf(input.idempotencyKey),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          requestId: input.requestId,
          target: input.target,
          user: input.user,
        },
        req,
      )
      const workflowStatus = parseWorkflowStatus(state)
      if (input.target === "draft") {
        await createReviewComment(
          payload,
          {
            body: input.reason ?? "",
            editionId: input.editionId,
            kind: "request-changes",
            user: input.user,
            workflowRevision: input.expectedRevision + 1,
          },
          req,
        )
      }
      if (workflowStatus !== "approved" && workflowStatus !== "draft") {
        throw fail("REVIEWER_EDITION_STATE_INVALID", workflowStatus)
      }
      const response: ReviewerEditionDecisionResponse = {
        editionId: input.editionId,
        workflowRevision: input.expectedRevision + 1,
        workflowStatus,
      }
      const claims = reviewerClaimsOf(input.user).claims
      await payload.create({
        collection: "reviewer-edition-decision-idempotency",
        data: {
          actorUserId: claims.userId,
          decisionId,
          edition: input.editionId,
          endpoint,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          requestId: input.requestId,
          responsePayload: response,
          tenant: tenantId,
          uniqueKey,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return { created: true, response }
    })
  } catch (error) {
    const workflowRevisionRace =
      error instanceof EditionWorkflowError && error.code === "EDITION_WORKFLOW_REVISION_CONFLICT"
    if (!isUniqueViolation(error) && !workflowRevisionRace) throw error
    const winner = await loadByUniqueKey(payload, uniqueKey)
    if (winner === null) throw error
    if (winner.requestHash !== requestHash) {
      throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different request")
    }
    return replay(payload, winner)
  }
}

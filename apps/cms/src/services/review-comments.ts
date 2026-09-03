import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import type { TransactionScope } from "../outbox/outbox"

export class ReviewCommentsError extends Error {
  override readonly name = "ReviewCommentsError"

  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): ReviewCommentsError => new ReviewCommentsError(code)

const numberOf = (value: unknown): number | null => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export type CreateReviewCommentInput = {
  readonly body: string
  readonly editionId: number
  readonly kind?: "comment" | "request-changes"
  readonly user: unknown
  readonly workflowRevision?: number
}

/** Creates feedback only after binding the author and edition to the session tenant. */
export const createReviewComment = async (
  payload: Payload,
  input: CreateReviewCommentInput,
  req: TransactionScope = {},
): Promise<number> => {
  const claims = resolveSessionClaims(input.user)
  if (claims === null || claims.kind !== "user") {
    throw fail("REVIEW_COMMENT_ACTOR_INVALID")
  }
  const body = input.body.trim()
  if (body.length === 0 || body.length > 2_000) throw fail("REVIEW_COMMENT_BODY_INVALID")

  const edition = await payload.findByID({
    collection: "content-editions",
    draft: true,
    id: input.editionId,
    depth: 0,
    overrideAccess: true,
    req,
  })
  /*
   * Super-admin is cross-tenant (claims.tenantId is null): scope follows the
   * edition's own tenant so request-changes can file its review comment.
   */
  const tenantId = numberOf(edition.tenant)
  if (tenantId === null) {
    throw fail("REVIEW_COMMENT_TENANT_MISMATCH")
  }
  if (
    claims.role !== "super-admin" &&
    (claims.tenantId === null || String(tenantId) !== String(claims.tenantId))
  ) {
    throw fail("REVIEW_COMMENT_TENANT_MISMATCH")
  }

  const created = await payload.create({
    collection: "review-comments",
    data: {
      author:
        numberOf(claims.userId) ??
        (() => {
          throw fail("REVIEW_COMMENT_ACTOR_INVALID")
        })(),
      body,
      edition: input.editionId,
      kind: input.kind ?? "comment",
      tenant: tenantId,
      ...(input.workflowRevision === undefined ? {} : { workflowRevision: input.workflowRevision }),
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return created.id
}

import {
  type AuditRecord,
  actorHasRole,
  auditRecord,
  freezeAuditTrail,
  type TransitionContext,
} from "../audit.js"
import {
  DOMAIN_ERROR_CODE,
  InvalidTransitionError,
  StaleAggregateStateError,
  TransitionGuardError,
} from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { ContentId, EditionId } from "../ids.js"
import { freezeOwnership, type SiteOwnership } from "../ownership.js"
import { type DomainResult, err, ok } from "../result.js"
import type { QualityAssessmentState } from "./quality-assessment.js"

export const CONTENT_EDITION_STATE = {
  APPROVED: "approved",
  ARCHIVED: "archived",
  COMPILED: "compiled",
  DRAFT: "draft",
  GENERATING: "generating",
  PUBLISHED: "published",
  REVIEW: "review",
} as const

export type ContentEditionState = (typeof CONTENT_EDITION_STATE)[keyof typeof CONTENT_EDITION_STATE]

export type ContentEdition = {
  readonly audit: readonly AuditRecord[]
  readonly contentId: ContentId
  readonly id: EditionId
  readonly ownership: SiteOwnership
  readonly revision: number
  readonly state: ContentEditionState
  readonly version: number
}

export type ContentEditionTransitionContext = TransitionContext & {
  readonly qualityAssessmentState: QualityAssessmentState | null
}

function isAllowedTransition(from: ContentEditionState, to: ContentEditionState): boolean {
  switch (from) {
    case "draft":
    case "generating":
    case "review":
    case "approved":
    case "compiled":
    case "published":
    case "archived":
      break
    default:
      return assertNever(from)
  }

  switch (to) {
    case "approved":
    case "archived":
    case "draft":
    case "generating":
    case "published":
    case "review":
      /*
       * Operator-driven free flow: every visible lane accepts a card from any
       * other lane (generating/compiled remain reachable for the internal
       * pipeline). Publish still requires a compiled release downstream.
       */
      return from !== to
    case "compiled":
      return from === "approved" || from === "compiled"
    default:
      return assertNever(to)
  }
}

function guardTransition(
  _from: ContentEditionState,
  _target: ContentEditionState,
  _context: ContentEditionTransitionContext,
): DomainResult<null> {
  /*
   * Free operator flow (2026-09 redesign): no per-role or evidence gates on
   * lane moves; audit entries record who moved the card. Quality evaluation
   * stays available through the pipeline API but no longer gates publishing.
   */
  return ok(null)
}

export function transitionContentEdition(
  edition: ContentEdition,
  target: ContentEditionState,
  context: ContentEditionTransitionContext,
): DomainResult<ContentEdition> {
  if (edition.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, edition.revision))
  }
  if (!isAllowedTransition(edition.state, target)) {
    return err(
      new InvalidTransitionError(
        DOMAIN_ERROR_CODE.CONTENT_EDITION_TRANSITION_NOT_ALLOWED,
        edition.state,
        target,
      ),
    )
  }
  const guard = guardTransition(edition.state, target, context)
  if (!guard.ok) {
    return guard
  }
  return ok(
    Object.freeze({
      ...edition,
      audit: freezeAuditTrail([
        ...edition.audit,
        auditRecord(`content-edition.${edition.state}.${target}`, context),
      ]),
      ownership: freezeOwnership(edition.ownership),
      revision: edition.revision + 1,
      state: target,
    }),
  )
}

export function createDraftEditionFromPublished(
  edition: ContentEdition,
  id: EditionId,
  context: TransitionContext,
): DomainResult<ContentEdition> {
  if (edition.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, edition.revision))
  }
  if (edition.state !== "published") {
    return err(
      new TransitionGuardError(
        DOMAIN_ERROR_CODE.CONTENT_EDITION_SOURCE_NOT_PUBLISHED,
        "A new draft version requires a published source edition",
      ),
    )
  }
  if (!actorHasRole(context.actor, "editor")) {
    return err(
      new TransitionGuardError(
        DOMAIN_ERROR_CODE.CONTENT_EDITION_EDITOR_REQUIRED,
        "Editor role is required to create a draft version",
      ),
    )
  }
  return ok(
    Object.freeze({
      audit: freezeAuditTrail([
        auditRecord("content-edition.draft.created-from-published", context),
      ]),
      contentId: edition.contentId,
      id,
      ownership: freezeOwnership(edition.ownership),
      revision: 0,
      state: "draft",
      version: edition.version + 1,
    }),
  )
}

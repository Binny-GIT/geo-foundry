import {
  auditRecord,
  freezeAuditTrail,
  type AuditRecord,
  type TransitionContext,
} from "../audit.js"
import {
  DOMAIN_ERROR_CODE,
  InvalidTransitionError,
  StaleAggregateStateError,
  TransitionGuardError,
} from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { ContentId, SiteId, UrlId } from "../ids.js"
import { freezeOwnership, type SiteOwnership } from "../ownership.js"
import { err, ok, type DomainResult } from "../result.js"

export const URL_RECORD_STATE = {
  ACTIVE: "active",
  GONE: "gone",
  REDIRECTED: "redirected",
  RESERVED: "reserved",
} as const

export type UrlRecordState = (typeof URL_RECORD_STATE)[keyof typeof URL_RECORD_STATE]

export type UrlRecord = {
  readonly audit: readonly AuditRecord[]
  readonly contentId: ContentId
  readonly id: UrlId
  readonly locale: string
  readonly ownership: SiteOwnership
  readonly pathname: string
  readonly revision: number
  readonly state: UrlRecordState
}

export type RedirectTarget = {
  readonly siteId: SiteId
  readonly state: UrlRecordState
  readonly urlId: UrlId
}

export type UrlRecordTransitionContext = TransitionContext & {
  readonly redirectTarget: RedirectTarget | null
}

function isAllowedTransition(from: UrlRecordState, to: UrlRecordState): boolean {
  switch (from) {
    case "reserved":
    case "active":
    case "gone":
    case "redirected":
      break
    default:
      return assertNever(from)
  }

  switch (to) {
    case "active":
      return from === "reserved"
    case "gone":
    case "redirected":
      return from === "active"
    case "reserved":
      return false
    default:
      return assertNever(to)
  }
}

function guardRedirect(
  record: UrlRecord,
  target: UrlRecordState,
  context: UrlRecordTransitionContext,
): DomainResult<null> {
  switch (target) {
    case "redirected":
      if (context.redirectTarget === null || context.redirectTarget.state !== "active") {
        return err(
          new TransitionGuardError(
            DOMAIN_ERROR_CODE.URL_REDIRECT_TARGET_NOT_ACTIVE,
            "Redirect target must be an active URL",
          ),
        )
      }
      return context.redirectTarget.siteId.value === record.ownership.siteId.value
        ? ok(null)
        : err(
            new TransitionGuardError(
              DOMAIN_ERROR_CODE.URL_REDIRECT_CROSS_SITE,
              "Redirect target must belong to the same site",
            ),
          )
    case "active":
    case "gone":
    case "reserved":
      return ok(null)
  }
}

export function transitionUrlRecord(
  record: UrlRecord,
  target: UrlRecordState,
  context: UrlRecordTransitionContext,
): DomainResult<UrlRecord> {
  if (record.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, record.revision))
  }
  if (!isAllowedTransition(record.state, target)) {
    return err(
      new InvalidTransitionError(
        DOMAIN_ERROR_CODE.URL_RECORD_TRANSITION_NOT_ALLOWED,
        record.state,
        target,
      ),
    )
  }
  const guard = guardRedirect(record, target, context)
  if (!guard.ok) {
    return guard
  }
  return ok(
    Object.freeze({
      ...record,
      audit: freezeAuditTrail([
        ...record.audit,
        auditRecord(`url-record.${record.state}.${target}`, context),
      ]),
      ownership: freezeOwnership(record.ownership),
      revision: record.revision + 1,
      state: target,
    }),
  )
}

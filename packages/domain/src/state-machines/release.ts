import {
  actorHasRole,
  auditRecord,
  freezeAuditTrail,
  type AuditRecord,
  type TransitionContext,
} from "../audit.js"
import type { Sha256Hash } from "../determinism.js"
import {
  DOMAIN_ERROR_CODE,
  InvalidTransitionError,
  StaleAggregateStateError,
  TransitionGuardError,
} from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { ReleaseId } from "../ids.js"
import { freezeOwnership, type SiteOwnership } from "../ownership.js"
import { err, ok, type DomainResult } from "../result.js"

export const RELEASE_STATE = {
  BUILDING: "building",
  CURRENT: "current",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
  SUPERSEDED: "superseded",
  UPLOADED: "uploaded",
  VALIDATED: "validated",
} as const

export type ReleaseState = (typeof RELEASE_STATE)[keyof typeof RELEASE_STATE]

export type Release = {
  readonly audit: readonly AuditRecord[]
  readonly id: ReleaseId
  readonly manifestHash: Sha256Hash
  readonly ownership: SiteOwnership
  readonly revision: number
  readonly state: ReleaseState
}

export type ReleaseTransitionContext = TransitionContext & {
  readonly manifestVerified: boolean
  readonly pointerCasMatched: boolean
}

const RELEASE_GUARD_REQUIREMENT = {
  building: "none",
  current: "publish",
  failed: "none",
  rolled_back: "rollback",
  superseded: "publisher",
  uploaded: "none",
  validated: "none",
} as const satisfies Record<ReleaseState, "none" | "publish" | "publisher" | "rollback">

type ReleaseGuardRequirement = (typeof RELEASE_GUARD_REQUIREMENT)[ReleaseState]

function isAllowedTransition(from: ReleaseState, to: ReleaseState): boolean {
  switch (from) {
    case "building":
    case "validated":
    case "uploaded":
    case "current":
    case "failed":
    case "rolled_back":
    case "superseded":
      break
    default:
      return assertNever(from)
  }

  switch (to) {
    case "building":
      return false
    case "current":
      return from === "uploaded"
    case "failed":
      return from === "building" || from === "uploaded" || from === "validated"
    case "rolled_back":
    case "superseded":
      return from === "current"
    case "uploaded":
      return from === "validated"
    case "validated":
      return from === "building"
    default:
      return assertNever(to)
  }
}

function guardTransition(
  requirement: ReleaseGuardRequirement,
  context: ReleaseTransitionContext,
): DomainResult<null> {
  switch (requirement) {
    case "publish":
      if (!actorHasRole(context.actor, "publisher")) {
        return err(
          new TransitionGuardError(
            DOMAIN_ERROR_CODE.RELEASE_PUBLISHER_REQUIRED,
            "Publisher role is required for this release transition",
          ),
        )
      }
      if (!context.manifestVerified) {
        return err(
          new TransitionGuardError(
            DOMAIN_ERROR_CODE.RELEASE_MANIFEST_NOT_VERIFIED,
            "Verified manifest is required before making a release current",
          ),
        )
      }
      return context.pointerCasMatched
        ? ok(null)
        : err(
            new TransitionGuardError(
              DOMAIN_ERROR_CODE.RELEASE_POINTER_CAS_CONFLICT,
              "Current pointer compare-and-swap did not match",
            ),
          )
    case "rollback":
      if (!actorHasRole(context.actor, "publisher")) {
        return err(
          new TransitionGuardError(
            DOMAIN_ERROR_CODE.RELEASE_PUBLISHER_REQUIRED,
            "Publisher role is required for this release transition",
          ),
        )
      }
      return context.pointerCasMatched
        ? ok(null)
        : err(
            new TransitionGuardError(
              DOMAIN_ERROR_CODE.RELEASE_POINTER_CAS_CONFLICT,
              "Current pointer compare-and-swap did not match",
            ),
          )
    case "publisher":
      return actorHasRole(context.actor, "publisher")
        ? ok(null)
        : err(
            new TransitionGuardError(
              DOMAIN_ERROR_CODE.RELEASE_PUBLISHER_REQUIRED,
              "Publisher role is required for this release transition",
            ),
          )
    case "none":
      return ok(null)
  }
}

export function transitionRelease(
  release: Release,
  target: ReleaseState,
  context: ReleaseTransitionContext,
): DomainResult<Release> {
  if (release.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, release.revision))
  }
  if (!isAllowedTransition(release.state, target)) {
    return err(
      new InvalidTransitionError(
        DOMAIN_ERROR_CODE.RELEASE_TRANSITION_NOT_ALLOWED,
        release.state,
        target,
      ),
    )
  }
  const guard = guardTransition(RELEASE_GUARD_REQUIREMENT[target], context)
  if (!guard.ok) {
    return guard
  }
  return ok(
    Object.freeze({
      ...release,
      audit: freezeAuditTrail([
        ...release.audit,
        auditRecord(`release.${release.state}.${target}`, context),
      ]),
      ownership: freezeOwnership(release.ownership),
      revision: release.revision + 1,
      state: target,
    }),
  )
}

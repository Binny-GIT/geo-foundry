import {
  auditRecord,
  freezeAuditTrail,
  type AuditRecord,
  type TransitionContext,
} from "../audit.js"
import type { Sha256Hash } from "../determinism.js"
import { DOMAIN_ERROR_CODE, InvalidTransitionError, StaleAggregateStateError } from "../errors.js"
import { assertNever } from "../exhaustive.js"
import type { AssessmentId } from "../ids.js"
import { freezeOwnership, type SiteOwnership } from "../ownership.js"
import { err, ok, type DomainResult } from "../result.js"

export const QUALITY_ASSESSMENT_STATE = {
  ERROR: "error",
  FAILED: "failed",
  PASSED: "passed",
  PENDING: "pending",
  RUNNING: "running",
} as const

export type QualityAssessmentState =
  (typeof QUALITY_ASSESSMENT_STATE)[keyof typeof QUALITY_ASSESSMENT_STATE]

export type QualityIssue = {
  readonly code: string
  readonly severity: "low" | "medium" | "high" | "critical"
}

export type QualityEvidence = {
  readonly inputHash: Sha256Hash
  readonly issues: readonly QualityIssue[]
  readonly modelId: string
  readonly promptVersion: string
  readonly provider: string
  readonly thresholdsHash: Sha256Hash
}

export type QualityAssessment = {
  readonly audit: readonly AuditRecord[]
  readonly evidence: QualityEvidence
  readonly id: AssessmentId
  readonly ownership: SiteOwnership
  readonly revision: number
  readonly state: QualityAssessmentState
}

function isAllowedTransition(from: QualityAssessmentState, to: QualityAssessmentState): boolean {
  switch (from) {
    case "pending":
    case "running":
    case "error":
    case "failed":
    case "passed":
      break
    default:
      return assertNever(from)
  }

  switch (to) {
    case "error":
    case "failed":
    case "passed":
      return from === "running"
    case "pending":
      return false
    case "running":
      return from === "pending"
    default:
      return assertNever(to)
  }
}

export function transitionQualityAssessment(
  assessment: QualityAssessment,
  target: QualityAssessmentState,
  context: TransitionContext,
): DomainResult<QualityAssessment> {
  if (assessment.revision !== context.expectedRevision) {
    return err(new StaleAggregateStateError(context.expectedRevision, assessment.revision))
  }
  if (!isAllowedTransition(assessment.state, target)) {
    return err(
      new InvalidTransitionError(
        DOMAIN_ERROR_CODE.QUALITY_ASSESSMENT_TRANSITION_NOT_ALLOWED,
        assessment.state,
        target,
      ),
    )
  }
  return ok(
    Object.freeze({
      ...assessment,
      audit: freezeAuditTrail([
        ...assessment.audit,
        auditRecord(`quality-assessment.${assessment.state}.${target}`, context),
      ]),
      evidence: Object.freeze({
        ...assessment.evidence,
        issues: Object.freeze(
          assessment.evidence.issues.map((issue) => Object.freeze({ ...issue })),
        ),
      }),
      ownership: freezeOwnership(assessment.ownership),
      revision: assessment.revision + 1,
      state: target,
    }),
  )
}

import {
  createFixedClock,
  createServiceAuditActor,
  createUserAuditActor,
  parseAssessmentId,
  parseContentId,
  parseEditionId,
  parseOperationId,
  parseReleaseId,
  parseSha256Hash,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  parseUserId,
  type AuditActor,
  type DomainResult,
  type SiteOwnership,
  type UserRole,
} from "../src/index.js"

export function unwrapResult<T>(result: DomainResult<T>): T {
  if (!result.ok) {
    throw result.error
  }
  return result.value
}

export const clock = createFixedClock("2026-08-17T10:00:00.000Z")
export const tenantId = unwrapResult(parseTenantId("tenant-1"))
export const siteId = unwrapResult(parseSiteId("site-1"))
export const otherSiteId = unwrapResult(parseSiteId("site-2"))
export const operationId = unwrapResult(parseOperationId("operation-1"))
export const contentId = unwrapResult(parseContentId("content-1"))
export const editionId = unwrapResult(parseEditionId("edition-1"))
export const assessmentId = unwrapResult(parseAssessmentId("assessment-1"))
export const releaseId = unwrapResult(parseReleaseId("release-1"))
export const urlId = unwrapResult(parseUrlId("url-1"))
export const hash = unwrapResult(parseSha256Hash("a".repeat(64)))

export const ownership: SiteOwnership = {
  scope: "site",
  siteId,
  tenantId,
}

export function userActor(role: UserRole): AuditActor {
  return createUserAuditActor({ userId: unwrapResult(parseUserId(`user-${role}`)), role })
}

export const serviceActor = createServiceAuditActor({ operationId, tenantId })

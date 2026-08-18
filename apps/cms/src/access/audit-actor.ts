import { createUserAuditActor, parseUserId, type AuditActor } from "@geo/domain"

import { CMS_ROLE } from "./roles"
import type { SessionClaims } from "./session"

/**
 * Audit actor extraction: user session claims become immutable domain audit actors.
 *
 * Anonymous or malformed sessions have no audit actor. Service sessions
 * (`content-service`) are operation-scoped: their ServiceAuditActor requires a
 * real OperationId and is constructed by the operation layer (Todo 17), never
 * fabricated here from a user id.
 */
export function auditActorFromClaims(claims: SessionClaims | null): AuditActor | null {
  if (claims === null || claims.role === CMS_ROLE.CONTENT_SERVICE) {
    return null
  }
  const userId = parseUserId(claims.userId)
  if (!userId.ok) {
    return null
  }
  return createUserAuditActor({ role: claims.role, userId: userId.value })
}

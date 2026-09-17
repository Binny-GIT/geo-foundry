import { type AuditActor, createUserAuditActor, parseUserId } from "@geo/domain"

import { CMS_ROLE } from "./roles"
import type { SessionClaims } from "./session"

/**
 * Audit actor extraction: user session claims become immutable domain audit actors.
 *
 * Anonymous or malformed sessions have no audit actor. Service sessions
 * (`content-service`, `automation`) are never turned into user actors:
 * content-service is operation-scoped (its ServiceAuditActor requires a real
 * OperationId and is built by the operation layer, Todo 17), and automation only
 * ever writes to the intake inbox, which carries no audit log of its own.
 */
export function auditActorFromClaims(claims: SessionClaims | null): AuditActor | null {
  if (
    claims === null ||
    claims.role === CMS_ROLE.CONTENT_SERVICE ||
    claims.role === CMS_ROLE.AUTOMATION
  ) {
    return null
  }
  const userId = parseUserId(claims.userId)
  if (!userId.ok) {
    return null
  }
  return createUserAuditActor({ role: claims.role, userId: userId.value })
}

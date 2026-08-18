import { assertNever } from "./exhaustive.js"
import type { Clock, Instant } from "./determinism.js"
import type { OperationId, TenantId, UserId } from "./ids.js"

export const USER_ROLE = {
  EDITOR: "editor",
  PUBLISHER: "publisher",
  REVIEWER: "reviewer",
  SUPER_ADMIN: "super-admin",
  TENANT_ADMIN: "tenant-admin",
} as const

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE]

export type UserAuditActor = {
  readonly kind: "user"
  readonly role: UserRole
  readonly userId: UserId
}

export type ServiceAuditActor = {
  readonly kind: "service"
  readonly operationId: OperationId
  readonly service: "content-service"
  readonly tenantId: TenantId
}

export type AuditActor = UserAuditActor | ServiceAuditActor

export type AuditRecord = {
  readonly action: string
  readonly actor: AuditActor
  readonly at: Instant
}

export type TransitionContext = {
  readonly actor: AuditActor
  readonly clock: Clock
  readonly expectedRevision: number
}

export function createUserAuditActor(actor: Omit<UserAuditActor, "kind">): UserAuditActor {
  return freezeAuditActor({ ...actor, kind: "user" })
}

export function createServiceAuditActor(
  actor: Omit<ServiceAuditActor, "kind" | "service">,
): ServiceAuditActor {
  return freezeAuditActor({ ...actor, kind: "service", service: "content-service" })
}

export function freezeAuditActor(actor: UserAuditActor): UserAuditActor
export function freezeAuditActor(actor: ServiceAuditActor): ServiceAuditActor
export function freezeAuditActor(actor: AuditActor): AuditActor
export function freezeAuditActor(actor: AuditActor): AuditActor {
  switch (actor.kind) {
    case "service":
      return Object.freeze({ ...actor })
    case "user":
      return Object.freeze({ ...actor })
    default:
      return assertNever(actor)
  }
}

export function actorHasRole(actor: AuditActor, role: UserRole): boolean {
  switch (actor.kind) {
    case "service":
      return false
    case "user":
      return actor.role === role
    default:
      return assertNever(actor)
  }
}

export function auditRecord(action: string, context: TransitionContext): AuditRecord {
  return freezeAuditRecord({ action, actor: context.actor, at: context.clock.now() })
}

export function freezeAuditRecord(record: AuditRecord): AuditRecord {
  return Object.freeze({
    action: record.action,
    actor: freezeAuditActor(record.actor),
    at: Object.freeze({ ...record.at }),
  })
}

export function freezeAuditTrail(audit: readonly AuditRecord[]): readonly AuditRecord[] {
  return Object.freeze(audit.map((record) => freezeAuditRecord(record)))
}

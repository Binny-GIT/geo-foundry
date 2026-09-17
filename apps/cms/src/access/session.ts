import { CMS_ROLE, type CmsRole, isCmsRole } from "./roles"

export type TenantRef = string | number

export type SessionClaims = {
  readonly kind: "service" | "user"
  readonly role: CmsRole
  readonly tenantId: TenantRef | null
  readonly userId: string
}

/*
 * 机器身份。两个角色都算 service，但能力完全不同：
 * - content-service 是 Worker 的零信任身份，可调 /api/internal/*；
 * - automation 是外部工具的投稿身份，internal 守卫按 role 精确匹配把它挡在外面。
 * 归为同一 kind 的意义是让「服务身份不得把稿源采纳成文章」只写一次判断。
 */
const SERVICE_KIND_ROLES: readonly CmsRole[] = [CMS_ROLE.AUTOMATION, CMS_ROLE.CONTENT_SERVICE]
const CROSS_TENANT_ROLE = CMS_ROLE.SUPER_ADMIN

const roleKind = (role: CmsRole): SessionClaims["kind"] =>
  SERVICE_KIND_ROLES.includes(role) ? "service" : "user"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const userIdFrom = (id: unknown): string | null => {
  if (typeof id === "string" && id.length > 0) {
    return id
  }
  if (typeof id === "number" && Number.isInteger(id)) {
    return String(id)
  }
  return null
}

const tenantIdFrom = (tenant: unknown): TenantRef | null => {
  if (typeof tenant === "string" && tenant.length > 0) {
    return tenant
  }
  if (typeof tenant === "number" && Number.isInteger(tenant)) {
    return tenant
  }
  if (isRecord(tenant)) {
    return tenantIdFrom(tenant["id"])
  }
  return null
}

/**
 * Deny-by-default session claims resolution.
 *
 * - anonymous, malformed, role-less, or id-less authentication resolves to null
 * - every non-super-admin role MUST be bound to exactly one tenant
 * - super-admin is the only cross-tenant role and MUST NOT be tenant-bound
 */
export function resolveSessionClaims(user: unknown): SessionClaims | null {
  if (!isRecord(user)) {
    return null
  }
  const userId = userIdFrom(user["id"])
  if (userId === null) {
    return null
  }
  const role = user["role"]
  if (!isCmsRole(role)) {
    return null
  }
  const tenantId = tenantIdFrom(user["tenant"])
  if (role === CROSS_TENANT_ROLE) {
    if (tenantId !== null) {
      return null
    }
    return Object.freeze({ kind: roleKind(role), role, tenantId: null, userId })
  }
  if (tenantId === null) {
    return null
  }
  return Object.freeze({ kind: roleKind(role), role, tenantId, userId })
}

export const isCrossTenantClaims = (claims: SessionClaims): boolean =>
  claims.role === CROSS_TENANT_ROLE

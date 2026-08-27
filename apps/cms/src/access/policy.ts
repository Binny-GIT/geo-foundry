import { CMS_ROLE, type CmsRole } from "./roles"
import type { SessionClaims } from "./session"

export const CMS_RESOURCE = {
  TENANTS: "tenants",
  USERS: "users",
  SITES: "sites",
  DOMAINS: "domains",
  CONTENTS: "contents",
  EDITIONS: "editions",
  MEDIA: "media",
  URL_RECORDS: "url-records",
  OPERATIONS: "operations",
  ASSESSMENTS: "assessments",
  RELEASES: "releases",
  CONNECTORS: "connectors",
  INTAKE_ITEMS: "intake-items",
  SOURCE_SNAPSHOTS: "source-snapshots",
  ARTICLE_SOURCES: "article-sources",
  REVIEW_COMMENTS: "review-comments",
  PUBLICATION_PLANS: "publication-plans",
  PERFORMANCE_SNAPSHOTS: "performance-snapshots",
} as const

export type CmsResource = (typeof CMS_RESOURCE)[keyof typeof CMS_RESOURCE]

export const CMS_RESOURCES: readonly CmsResource[] = Object.values(CMS_RESOURCE)

export const CMS_ACTION = {
  CREATE: "create",
  READ: "read",
  UPDATE: "update",
  DELETE: "delete",
} as const

export type CmsAction = (typeof CMS_ACTION)[keyof typeof CMS_ACTION]

export const CMS_ACTIONS: readonly CmsAction[] = Object.values(CMS_ACTION)

type ActionMatrix = Readonly<Record<CmsAction, boolean>>

/**
 * Authorization baseline from the approved plan.
 *
 * - super-admin: cross-tenant administration and diagnostics only
 * - tenant-admin: manage tenant users, Site/Domain/strategy/thresholds in one tenant
 * - editor: create/edit draft Content and Edition, upload tenant media
 * - reviewer: approve/reject Editions, inspect immutable quality evidence
 * - publisher: publish/supersede/rollback; cannot edit content
 * - content-service: service identity; write generated Edition versions and assessments only
 */
const POLICY: Readonly<Record<CmsRole, Readonly<Record<CmsResource, ActionMatrix>>>> = {
  [CMS_ROLE.SUPER_ADMIN]: {
    tenants: { create: true, read: true, update: true, delete: false },
    users: { create: true, read: true, update: true, delete: false },
    sites: { create: false, read: true, update: false, delete: false },
    domains: { create: false, read: true, update: false, delete: false },
    contents: { create: false, read: true, update: false, delete: false },
    editions: { create: false, read: true, update: false, delete: false },
    media: { create: false, read: true, update: false, delete: false },
    "url-records": { create: false, read: true, update: false, delete: false },
    operations: { create: false, read: true, update: false, delete: false },
    assessments: { create: false, read: true, update: false, delete: false },
    releases: { create: false, read: true, update: false, delete: false },
    connectors: { create: false, read: true, update: false, delete: false },
    "intake-items": { create: false, read: true, update: false, delete: false },
    "source-snapshots": { create: false, read: true, update: false, delete: false },
    "article-sources": { create: false, read: true, update: false, delete: false },
    "review-comments": { create: false, read: true, update: false, delete: false },
    "publication-plans": { create: false, read: true, update: false, delete: false },
    "performance-snapshots": { create: false, read: true, update: false, delete: false },
  },
  [CMS_ROLE.TENANT_ADMIN]: {
    tenants: { create: false, read: true, update: false, delete: false },
    users: { create: true, read: true, update: true, delete: false },
    sites: { create: true, read: true, update: true, delete: false },
    domains: { create: true, read: true, update: true, delete: false },
    contents: { create: false, read: true, update: false, delete: false },
    editions: { create: false, read: true, update: false, delete: false },
    media: { create: false, read: true, update: false, delete: false },
    "url-records": { create: false, read: true, update: false, delete: false },
    operations: { create: false, read: true, update: false, delete: false },
    assessments: { create: false, read: true, update: false, delete: false },
    releases: { create: false, read: true, update: false, delete: false },
    connectors: { create: true, read: true, update: true, delete: false },
    "intake-items": { create: true, read: true, update: true, delete: false },
    "source-snapshots": { create: false, read: true, update: false, delete: false },
    "article-sources": { create: true, read: true, update: false, delete: false },
    "review-comments": { create: true, read: true, update: false, delete: false },
    "publication-plans": { create: false, read: true, update: false, delete: false },
    "performance-snapshots": { create: false, read: true, update: false, delete: false },
  },
  [CMS_ROLE.EDITOR]: {
    tenants: { create: false, read: false, update: false, delete: false },
    users: { create: false, read: false, update: false, delete: false },
    sites: { create: false, read: true, update: false, delete: false },
    domains: { create: false, read: true, update: false, delete: false },
    contents: { create: true, read: true, update: true, delete: false },
    editions: { create: true, read: true, update: true, delete: false },
    media: { create: true, read: true, update: true, delete: false },
    "url-records": { create: false, read: true, update: false, delete: false },
    operations: { create: false, read: true, update: false, delete: false },
    assessments: { create: false, read: true, update: false, delete: false },
    releases: { create: false, read: false, update: false, delete: false },
    connectors: { create: false, read: true, update: false, delete: false },
    "intake-items": { create: true, read: true, update: true, delete: false },
    "source-snapshots": { create: false, read: true, update: false, delete: false },
    "article-sources": { create: true, read: true, update: false, delete: false },
    "review-comments": { create: true, read: true, update: false, delete: false },
    "publication-plans": { create: false, read: true, update: false, delete: false },
    "performance-snapshots": { create: false, read: true, update: false, delete: false },
  },
  [CMS_ROLE.REVIEWER]: {
    tenants: { create: false, read: false, update: false, delete: false },
    users: { create: false, read: false, update: false, delete: false },
    sites: { create: false, read: true, update: false, delete: false },
    domains: { create: false, read: true, update: false, delete: false },
    contents: { create: false, read: true, update: false, delete: false },
    editions: { create: false, read: true, update: false, delete: false },
    media: { create: false, read: true, update: false, delete: false },
    "url-records": { create: false, read: false, update: false, delete: false },
    operations: { create: false, read: false, update: false, delete: false },
    assessments: { create: false, read: true, update: false, delete: false },
    releases: { create: false, read: false, update: false, delete: false },
    connectors: { create: false, read: true, update: false, delete: false },
    "intake-items": { create: false, read: true, update: false, delete: false },
    "source-snapshots": { create: false, read: true, update: false, delete: false },
    "article-sources": { create: false, read: true, update: false, delete: false },
    "review-comments": { create: true, read: true, update: false, delete: false },
    "publication-plans": { create: false, read: true, update: false, delete: false },
    "performance-snapshots": { create: false, read: true, update: false, delete: false },
  },
  [CMS_ROLE.PUBLISHER]: {
    tenants: { create: false, read: false, update: false, delete: false },
    users: { create: false, read: false, update: false, delete: false },
    sites: { create: false, read: true, update: false, delete: false },
    domains: { create: false, read: true, update: false, delete: false },
    contents: { create: false, read: true, update: false, delete: false },
    editions: { create: false, read: true, update: false, delete: false },
    media: { create: false, read: true, update: false, delete: false },
    "url-records": { create: false, read: true, update: false, delete: false },
    operations: { create: false, read: true, update: false, delete: false },
    assessments: { create: false, read: true, update: false, delete: false },
    releases: { create: false, read: true, update: false, delete: false },
    connectors: { create: false, read: true, update: false, delete: false },
    "intake-items": { create: false, read: true, update: false, delete: false },
    "source-snapshots": { create: false, read: true, update: false, delete: false },
    "article-sources": { create: false, read: true, update: false, delete: false },
    "review-comments": { create: false, read: true, update: false, delete: false },
    "publication-plans": { create: false, read: true, update: false, delete: false },
    "performance-snapshots": { create: false, read: true, update: false, delete: false },
  },
  [CMS_ROLE.CONTENT_SERVICE]: {
    tenants: { create: false, read: false, update: false, delete: false },
    users: { create: false, read: false, update: false, delete: false },
    sites: { create: false, read: true, update: false, delete: false },
    domains: { create: false, read: false, update: false, delete: false },
    contents: { create: false, read: true, update: false, delete: false },
    editions: { create: true, read: true, update: true, delete: false },
    media: { create: false, read: false, update: false, delete: false },
    "url-records": { create: false, read: false, update: false, delete: false },
    operations: { create: false, read: false, update: false, delete: false },
    assessments: { create: true, read: true, update: false, delete: false },
    releases: { create: false, read: false, update: false, delete: false },
    connectors: { create: false, read: true, update: false, delete: false },
    "intake-items": { create: true, read: true, update: true, delete: false },
    "source-snapshots": { create: true, read: true, update: false, delete: false },
    "article-sources": { create: false, read: true, update: false, delete: false },
    "review-comments": { create: false, read: false, update: false, delete: false },
    "publication-plans": { create: false, read: false, update: false, delete: false },
    "performance-snapshots": { create: false, read: false, update: false, delete: false },
  },
}

export type TenantScope = { readonly tenant: { readonly equals: string | number } }
export type SelfScope = { readonly id: { readonly equals: string | number } }

/** Anonymous or malformed sessions are denied everything (deny-by-default). */
export function decideAccess(
  claims: SessionClaims | null,
  resource: CmsResource,
  action: CmsAction,
): boolean {
  if (claims === null) {
    return false
  }
  return POLICY[claims.role][resource][action]
}

/**
 * Server-side tenant scope for read queries.
 * Returns `true` only for the cross-tenant role; every other role
 * receives a mandatory Where constraint and can never widen it client-side.
 */
export function readScope(
  claims: SessionClaims | null,
  resource: CmsResource,
): boolean | TenantScope | SelfScope {
  if (!decideAccess(claims, resource, CMS_ACTION.READ)) {
    // 角色矩阵拒绝列表读取时，仍允许读取自己的 profile——
    // 管理端 UI 依赖 GET /api/users/me，拒绝会令 editor 等角色的后台页产生 403。
    if (claims !== null && resource === CMS_RESOURCE.USERS) {
      return { id: { equals: claims.userId } }
    }
    return false
  }
  if (claims === null) {
    return false
  }
  if (claims.role === CMS_ROLE.SUPER_ADMIN) {
    return true
  }
  if (claims.tenantId === null) {
    return false
  }
  if (resource === CMS_RESOURCE.TENANTS) {
    return { id: { equals: claims.tenantId } }
  }
  return { tenant: { equals: claims.tenantId } }
}

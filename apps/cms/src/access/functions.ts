import type { Access, Where } from "payload"

import { CMS_ACTION, type CmsResource, decideAccess, readScope } from "./policy"
import { CMS_ROLE } from "./roles"
import { resolveSessionClaims, type SessionClaims, type TenantRef } from "./session"

export const claimsFromRequest = (req: { user: unknown }): SessionClaims | null =>
  resolveSessionClaims(req.user)

const tenantScope = (tenantId: TenantRef): Where => ({ tenant: { equals: tenantId } })

const scopedWrite = (
  claims: SessionClaims | null,
  resource: CmsResource,
  action: (typeof CMS_ACTION)[keyof typeof CMS_ACTION],
): boolean | Where => {
  if (!decideAccess(claims, resource, action)) {
    return false
  }
  if (claims === null || claims.role === CMS_ROLE.SUPER_ADMIN) {
    return claims !== null
  }
  if (claims.tenantId === null) {
    return false
  }
  return tenantScope(claims.tenantId)
}

export type CollectionAccess = {
  readonly create: Access
  readonly read: Access
  readonly update: Access
  readonly delete: Access
}

export const collectionAccess = (resource: CmsResource): CollectionAccess => ({
  create: ({ req }) => decideAccess(claimsFromRequest(req), resource, CMS_ACTION.CREATE),
  read: ({ req }) => readScope(claimsFromRequest(req), resource),
  update: ({ req }) => scopedWrite(claimsFromRequest(req), resource, CMS_ACTION.UPDATE),
  delete: ({ req }) => scopedWrite(claimsFromRequest(req), resource, CMS_ACTION.DELETE),
})

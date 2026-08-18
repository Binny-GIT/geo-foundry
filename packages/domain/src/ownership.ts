import { assertNever } from "./exhaustive.js"
import type { SiteId, TenantId } from "./ids.js"

export type TenantOwnership = {
  readonly scope: "tenant"
  readonly tenantId: TenantId
}

export type SiteOwnership = {
  readonly scope: "site"
  readonly tenantId: TenantId
  readonly siteId: SiteId
}

export type Ownership = TenantOwnership | SiteOwnership

export function freezeOwnership(ownership: TenantOwnership): TenantOwnership
export function freezeOwnership(ownership: SiteOwnership): SiteOwnership
export function freezeOwnership(ownership: Ownership): Ownership
export function freezeOwnership(ownership: Ownership): Ownership {
  switch (ownership.scope) {
    case "site":
      return Object.freeze({ ...ownership })
    case "tenant":
      return Object.freeze({ ...ownership })
    default:
      return assertNever(ownership)
  }
}

import { type EntityToGroup, EntityType, groupNavItems } from "@payloadcms/ui/shared"
import type { ServerProps } from "payload"

import { NavLinks } from "./NavLinks"

/**
 * Custom admin sidebar. Nav visibility is computed with Payload's own
 * `groupNavItems` — the same function the stock Nav uses — so RBAC and
 * tenant scoping stay byte-identical to the verified default behavior; only
 * the presentation layer changes (per-item icons, section grouping driven
 * by each collection's `admin.group`, a brand header, and an account
 * footer). The mobile toggle button and the global open/close state live
 * outside this component (Payload's own template plus its NavProvider) and
 * are unaffected by replacing this component.
 */
export const Nav = (props: ServerProps) => {
  const { i18n, payload, permissions, visibleEntities } = props
  if (payload?.config === undefined || permissions === undefined || visibleEntities === undefined) {
    return null
  }
  const { collections, globals } = payload.config
  const groups = groupNavItems(
    [
      ...collections
        .filter((collection) => visibleEntities.collections.includes(collection.slug))
        .map((collection): EntityToGroup => ({ entity: collection, type: EntityType.collection })),
      ...globals
        .filter((global) => visibleEntities.globals.includes(global.slug))
        .map((global): EntityToGroup => ({ entity: global, type: EntityType.global })),
    ],
    permissions,
    i18n,
  )
  return <NavLinks groups={groups} />
}

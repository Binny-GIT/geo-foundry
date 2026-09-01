import type { ServerProps } from "payload"

import { NavLinks } from "./NavLinks"

/*
 * Custom admin sidebar. Item list and grouping come from CONSOLE_NAV — the
 * same curated registry the console shell renders — so both surfaces show an
 * identical, pipeline-organized navigation instead of mirroring every
 * collection table. Only serializable data (the visible collection slug
 * list) crosses the server→client boundary here; NavLinks resolves icons
 * and labels on the client, and Payload's visibleEntities keeps RBAC and
 * tenant scoping identical to the stock Nav.
 */
export const Nav = (props: ServerProps) => {
  const { payload, visibleEntities } = props
  if (payload?.config === undefined || visibleEntities === undefined) {
    return null
  }
  return <NavLinks visibleSlugs={visibleEntities.collections} />
}

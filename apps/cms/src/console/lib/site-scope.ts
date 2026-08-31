import type { Where } from "payload"

import type { ConsoleSession } from "./session.server"

/**
 * Display-level site scoping derived from the optional per-user site
 * assignment. A null `siteIds` session is unrestricted (super-admin,
 * tenant-admin, or no assignment). Payload's access layer remains the
 * authoritative permission boundary; these conditions only narrow Console
 * queries so scoped users do not wade through unrelated sites.
 */

const unrestricted = (session: ConsoleSession): boolean => session.siteIds === null

export const siteScopeWhere = (session: ConsoleSession): Where | undefined =>
  unrestricted(session) ? undefined : { site: { in: [...(session.siteIds ?? [])] } }

export const sitesIdScopeWhere = (session: ConsoleSession): Where | undefined =>
  unrestricted(session) ? undefined : { id: { in: [...(session.siteIds ?? [])] } }

export const combineWhere = (left: Where | undefined, right: Where | undefined): Where | undefined => {
  if (left === undefined) return right
  if (right === undefined) return left
  return { and: [left, right] }
}

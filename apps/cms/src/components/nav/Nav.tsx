import type { ServerProps } from "payload"

import {
  CONSOLE_NAV,
  CONSOLE_RESOURCES,
  type ConsoleNavItem,
  consoleRoute,
} from "@/console/lib/resources"

import { NAV_ICON_BY_SLUG } from "../icons"
import { NavLinks, type UnifiedNavItem } from "./NavLinks"

/*
 * Custom admin sidebar. Item list and grouping come from CONSOLE_NAV — the
 * same curated registry the console shell renders — so both surfaces show an
 * identical, pipeline-organized navigation instead of mirroring every
 * collection table. Payload's own visibleEntities still RBAC-filters each
 * resource entry, keeping tenant scoping identical to the stock Nav.
 */
export const Nav = (props: ServerProps) => {
  const { payload, visibleEntities } = props
  if (payload?.config === undefined || visibleEntities === undefined) {
    return null
  }

  const toItems = (entries: readonly ConsoleNavItem[]): readonly UnifiedNavItem[] =>
    entries.flatMap((entry): readonly UnifiedNavItem[] => {
      if (entry.kind === "static") {
        return [
          {
            href: entry.href,
            icon: entry.icon,
            label: entry.label.zh,
          },
        ]
      }
      if (!visibleEntities.collections.includes(entry.slug)) {
        return []
      }
      const resource = CONSOLE_RESOURCES[entry.slug]
      const icon = NAV_ICON_BY_SLUG[entry.slug]
      return [
        {
          href: consoleRoute.collection(entry.slug),
          ...(icon !== undefined ? { icon } : {}),
          label: resource.label.zh,
        },
      ]
    })

  return (
    <NavLinks
      adminItems={toItems(CONSOLE_NAV.admin)}
      businessItems={toItems(CONSOLE_NAV.business)}
    />
  )
}

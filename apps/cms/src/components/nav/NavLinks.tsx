"use client"

import "./nav-layout.css"

import { getTranslation } from "@payloadcms/translations"
import { Link, useAuth, useConfig, useNav, useTranslation } from "@payloadcms/ui"
import { EntityType, type NavGroupType } from "@payloadcms/ui/shared"
import { usePathname } from "next/navigation"
import { formatAdminURL } from "payload/shared"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import { GeoIcon } from "../branding/GeoIcon"
import { LogOutIcon, NAV_ICON_BY_SLUG } from "../icons"

type NavLinksProps = {
  readonly groups: readonly NavGroupType[]
}

const initialOf = (email: string | null) =>
  email !== null && email.length > 0 ? email.charAt(0).toUpperCase() : "?"

export const NavLinks = ({ groups }: NavLinksProps) => {
  const { hydrated, navOpen, navRef, shouldAnimate } = useNav()
  const pathname = usePathname()
  const { i18n, t } = useTranslation()
  const { config } = useConfig()
  const { user } = useAuth()
  const adminRoute = config.routes.admin

  const email = typeof user?.["email"] === "string" ? user["email"] : null
  const role = typeof user?.["role"] === "string" ? user["role"] : null
  const logoutHref = formatAdminURL({ adminRoute, path: config.admin.routes.logout })

  return (
    <aside
      className={cn(
        // `gf-sidebar` is the only class nav-layout.css's ancestor-scoped
        // show/hide rules touch on this element — deliberately the *only*
        // thing that sets `display` here, so it never has to out-specificity
        // a plain `.flex` utility. All real flex layout lives one level
        // down, on a child div those rules never select (mirrors Payload's
        // own outer `.nav` (visibility) / inner `.nav__scroll` (layout)
        // split — collapsing them onto one element is what broke the footer
        // pinning the first time).
        "gf-sidebar sticky top-0 h-screen w-[var(--nav-width)] shrink-0 overflow-hidden opacity-0",
        navOpen && "opacity-100",
        shouldAnimate && "transition-opacity duration-150 ease-in-out",
        hydrated && "gf-sidebar--hydrated",
      )}
      inert={!navOpen}
    >
      <div className="flex h-full flex-col bg-gfs-ink-900 text-white">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <GeoIcon size={26} />
          <span className="text-base font-bold tracking-tight">Geo Foundry</span>
        </div>

        <Separator className="mx-5 w-auto bg-white/10" />

        <ScrollArea className="min-h-0 flex-1" viewportRef={navRef}>
          <nav className="flex flex-col gap-5 px-3 py-4">
            {groups.map((group) => (
              <div className="flex flex-col gap-1" key={group.label}>
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.entities.map((entity) => {
                    const href =
                      entity.type === EntityType.collection
                        ? formatAdminURL({ adminRoute, path: `/collections/${entity.slug}` })
                        : formatAdminURL({ adminRoute, path: `/globals/${entity.slug}` })
                    const id =
                      entity.type === EntityType.collection
                        ? `nav-${entity.slug}`
                        : `nav-global-${entity.slug}`
                    // Same active-link rule as Payload's own DefaultNavClient:
                    // an exact segment match, not a loose prefix match.
                    const isActive =
                      pathname.startsWith(href) &&
                      ["/", undefined].includes(pathname[href.length])
                    const Icon = NAV_ICON_BY_SLUG[entity.slug]
                    const linkClassName = cn(
                      "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-white/70 no-underline transition-colors",
                      isActive ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white",
                    )
                    const content = (
                      <>
                        {isActive && (
                          <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gfs-accent-500" />
                        )}
                        {Icon !== undefined && <Icon size={17} strokeWidth={1.8} />}
                        <span className="truncate">{getTranslation(entity.label, i18n)}</span>
                      </>
                    )
                    if (pathname === href) {
                      return (
                        <div className={linkClassName} id={id} key={entity.slug}>
                          {content}
                        </div>
                      )
                    }
                    return (
                      <Link
                        className={linkClassName}
                        href={href}
                        id={id}
                        key={entity.slug}
                        prefetch={false}
                      >
                        {content}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <Separator className="mx-5 w-auto bg-white/10" />

        <div className="flex items-center gap-2.5 px-5 py-4">
          <Avatar className="bg-gfs-accent-500/20">
            <AvatarFallback className="bg-transparent text-gfs-accent-300">
              {initialOf(email)}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <strong className="truncate text-xs font-semibold text-white">
              {email ?? "Account"}
            </strong>
            {role !== null && (
              <span className="truncate text-[11px] text-white/50 capitalize">{role}</span>
            )}
          </div>
          <Button asChild aria-label={t("authentication:logOut")} size="icon" variant="ghost">
            <Link href={logoutHref} prefetch={false} title={t("authentication:logOut")}>
              <LogOutIcon size={16} strokeWidth={1.8} />
            </Link>
          </Button>
        </div>
      </div>
    </aside>
  )
}

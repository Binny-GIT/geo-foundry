"use client"

import "./nav.css"

import { getTranslation } from "@payloadcms/translations"
import { Link, Logout, NavGroup, useAuth, useConfig, useNav, useTranslation } from "@payloadcms/ui"
import { EntityType, type NavGroupType } from "@payloadcms/ui/shared"
import { usePathname } from "next/navigation"
import { formatAdminURL } from "payload/shared"

import { GeoIcon } from "../branding/GeoIcon"
import { NAV_ICON_BY_SLUG } from "../icons"

const baseClass = "nav"

type NavLinksProps = {
  readonly groups: readonly NavGroupType[]
}

/** One nav entry: active-indicator, optional icon, translated label. */
const linkContentOf = (
  entity: NavGroupType["entities"][number],
  isActive: boolean,
  i18n: Parameters<typeof getTranslation>[1],
) => {
  const Icon = NAV_ICON_BY_SLUG[entity.slug]
  return (
    <>
      {isActive && <div className={`${baseClass}__link-indicator`} />}
      {Icon !== undefined && <Icon size={17} strokeWidth={1.8} />}
      <span className={`${baseClass}__link-label`}>{getTranslation(entity.label, i18n)}</span>
    </>
  )
}

export const NavLinks = ({ groups }: NavLinksProps) => {
  const { hydrated, navOpen, navRef, shouldAnimate } = useNav()
  const pathname = usePathname()
  const { i18n } = useTranslation()
  const { config } = useConfig()
  const { user } = useAuth()
  const adminRoute = config.routes.admin

  const asideClassName = [
    baseClass,
    navOpen && `${baseClass}--nav-open`,
    shouldAnimate && `${baseClass}--nav-animate`,
    hydrated && `${baseClass}--nav-hydrated`,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")

  const email = typeof user?.["email"] === "string" ? user["email"] : null
  const role = typeof user?.["role"] === "string" ? user["role"] : null

  return (
    <aside className={asideClassName} inert={!navOpen}>
      <div className={`${baseClass}__scroll`} ref={navRef}>
        <div className="gf-nav-brand">
          <GeoIcon size={26} />
          <span>Geo Foundry</span>
        </div>
        <nav className={`${baseClass}__wrap`}>
          {groups.map((group) => (
            <NavGroup isOpen key={group.label} label={group.label}>
              {group.entities.map((entity) => {
                const href =
                  entity.type === EntityType.collection
                    ? formatAdminURL({ adminRoute, path: `/collections/${entity.slug}` })
                    : formatAdminURL({ adminRoute, path: `/globals/${entity.slug}` })
                const id =
                  entity.type === EntityType.collection
                    ? `nav-${entity.slug}`
                    : `nav-global-${entity.slug}`
                const isActive =
                  pathname.startsWith(href) && ["/", undefined].includes(pathname[href.length])
                if (pathname === href) {
                  return (
                    <div className={`${baseClass}__link`} id={id} key={entity.slug}>
                      {linkContentOf(entity, isActive, i18n)}
                    </div>
                  )
                }
                return (
                  <Link
                    className={`${baseClass}__link`}
                    href={href}
                    id={id}
                    key={entity.slug}
                    prefetch={false}
                  >
                    {linkContentOf(entity, isActive, i18n)}
                  </Link>
                )
              })}
            </NavGroup>
          ))}
        </nav>
        <div className={`${baseClass}__controls gf-nav-footer`}>
          <div className="gf-nav-footer__account">
            <strong>{email ?? "Account"}</strong>
            {role !== null && <span>{role}</span>}
          </div>
          <Logout />
        </div>
      </div>
    </aside>
  )
}

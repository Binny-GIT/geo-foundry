"use client"

import "./nav-layout.css"

import { getTranslation } from "@payloadcms/translations"
import { Link, useAuth, useConfig, useNav, useTranslation } from "@payloadcms/ui"
import { EntityType, type NavGroupType } from "@payloadcms/ui/shared"
import { usePathname } from "next/navigation"
import { formatAdminURL } from "payload/shared"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import { GeoIcon } from "../branding/GeoIcon"
import {
  ChevronDownIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  NAV_ICON_BY_SLUG,
  XIcon,
} from "../icons"

type NavLinksProps = {
  readonly groups: readonly NavGroupType[]
}

const initialOf = (email: string | null) =>
  email !== null && email.length > 0 ? email.charAt(0).toUpperCase() : "?"

/** UI languages registered in payload.config.ts `i18n.supportedLanguages`. */
const UI_LANGUAGES = ["zh", "en"] as const

const LANG_LABEL: Record<(typeof UI_LANGUAGES)[number], string> = {
  en: "EN",
  zh: "中",
}

/** Native names shown inside the dropdown menu. */
const LANG_NATIVE_LABEL: Record<(typeof UI_LANGUAGES)[number], string> = {
  en: "English",
  zh: "中文",
}

/*
 * Sidebar-local zh dictionary. Payload collection labels and admin.group
 * strings are plain config-level English — they don't flow through the
 * i18n translation pipeline (only Payload's own chrome does), so the
 * sidebar translates them here until the collections declare per-language
 * labels themselves. Keyed by slug / raw group string; unknown keys fall
 * back to the configured English label.
 */
const ZH_GROUP_LABEL: Readonly<Record<string, string>> = {
  Access: "访问控制",
  "Sites & Domains": "站点与域名",
  Content: "内容",
  "Quality & Release": "质量与发布",
}

const ZH_ENTITY_LABEL: Readonly<Record<string, string>> = {
  "content-editions": "内容版本",
  contents: "内容条目",
  domains: "域名",
  media: "媒体库",
  operations: "操作记录",
  "quality-assessments": "质量评估",
  releases: "发布版本",
  "rollback-intents": "回滚意图",
  sites: "站点",
  tenants: "租户",
  "url-records": "URL 记录",
  users: "用户",
}

const ZH_ROLE_LABEL: Readonly<Record<string, string>> = {
  "content-service": "内容服务",
  editor: "编辑",
  publisher: "发布",
  reviewer: "审阅",
  "super-admin": "超级管理员",
  "tenant-admin": "租户管理员",
}

export const NavLinks = ({ groups }: NavLinksProps) => {
  const { hydrated, navOpen, navRef, setNavOpen, shouldAnimate } = useNav()
  const pathname = usePathname()
  const { i18n, switchLanguage, t } = useTranslation()
  const { config } = useConfig()
  const { user } = useAuth()
  const adminRoute = config.routes.admin

  const email = typeof user?.["email"] === "string" ? user["email"] : null
  const role = typeof user?.["role"] === "string" ? user["role"] : null
  const logoutHref = formatAdminURL({ adminRoute, path: config.admin.routes.logout })
  const currentLang = UI_LANGUAGES.find((lang) => lang === i18n.language) ?? "zh"
  const isZH = currentLang === "zh"
  const roleLabel = isZH && role !== null ? (ZH_ROLE_LABEL[role] ?? role) : role

  const linkClassName = (isActive: boolean) =>
    cn(
      "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-white/70 no-underline transition-colors",
      isActive ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white",
    )

  return (
    <>
      {/*
       * Floating open button — only where Payload collapses the nav into a
       * drawer (<=1440px) and only while it's closed. Payload's own mobile
       * toggler (and its whole AppHeader) is hidden via nav-layout.css, so
       * this replaces it; keeping it OUTSIDE the <aside> matters, because
       * the aside itself is display:none when closed.
       */}
      {!navOpen && (
        <button
          aria-label={t("general:open") + " " + t("general:menu")}
          className={cn(
            "fixed left-4 top-4 z-40 flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-900 min-[1441px]:hidden",
          )}
          onClick={() => setNavOpen(true)}
          type="button"
        >
          <MenuIcon size={18} strokeWidth={1.8} />
        </button>
      )}

      <aside
        className={cn(
          // `gf-sidebar` is the only class nav-layout.css's ancestor-scoped
          // show/hide rules touch on this element — deliberately the *only*
          // thing that sets `display` here, so it never has to
          // out-specificity a plain `.flex` utility. All real flex layout
          // lives one level down, on a child div those rules never select
          // (mirrors Payload's own outer `.nav` (visibility) / inner
          // `.nav__scroll` (layout) split — collapsing them onto one
          // element is what broke the footer pinning the first time).
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
            <span className="flex-1 text-base font-bold tracking-tight">Geo Foundry</span>
            {/* Close button: only needed where the nav is a drawer. */}
            <button
              aria-label={t("general:close") + " " + t("general:menu")}
              className="flex size-8 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white min-[1441px]:hidden"
              onClick={() => setNavOpen(false)}
              type="button"
            >
              <XIcon size={18} strokeWidth={1.8} />
            </button>
          </div>

          <Separator className="mx-5 w-auto bg-white/10" />

          <ScrollArea className="min-h-0 flex-1" viewportRef={navRef}>
            <nav className="flex flex-col gap-5 px-3 py-4">
              <div className="flex flex-col gap-0.5">
                <Link
                  className={linkClassName(pathname === adminRoute)}
                  href={adminRoute}
                  id="nav-dashboard"
                  prefetch={false}
                >
                  {pathname === adminRoute && (
                    <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gfs-accent-500" />
                  )}
                  <LayoutGridIcon size={17} strokeWidth={1.8} />
                  <span className="truncate">{t("general:dashboard")}</span>
                </Link>
              </div>

              {groups.map((group) => (
                <div className="flex flex-col gap-1" key={group.label}>
                  <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    {isZH ? (ZH_GROUP_LABEL[group.label] ?? group.label) : group.label}
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
                      const content = (
                        <>
                          {isActive && (
                            <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gfs-accent-500" />
                          )}
                          {Icon !== undefined && <Icon size={17} strokeWidth={1.8} />}
                          <span className="truncate">
                            {isZH
                              ? (ZH_ENTITY_LABEL[entity.slug] ??
                                getTranslation(entity.label, i18n))
                              : getTranslation(entity.label, i18n)}
                          </span>
                        </>
                      )
                      if (pathname === href) {
                        return (
                          <div className={linkClassName(isActive)} id={id} key={entity.slug}>
                            {content}
                          </div>
                        )
                      }
                      return (
                        <Link
                          className={linkClassName(isActive)}
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
              {roleLabel !== null && (
                <span className="truncate text-[11px] text-white/50">{roleLabel}</span>
              )}
            </div>
            {/*
             * UI language dropdown. Payload resolves the admin language from
             * the `payload-lng` cookie (> Accept-Language > fallback); the
             * official switchLanguage server action writes that cookie and
             * refreshes the tree, so selecting an item is the whole
             * mechanism. Opens upward — the toggle lives in the sidebar
             * footer, there is no room below it.
             */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("general:language")}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white outline-none transition-colors hover:bg-white/20"
              >
                {LANG_LABEL[currentLang]}
                <ChevronDownIcon size={12} strokeWidth={2} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                {UI_LANGUAGES.map((lang) => (
                  <DropdownMenuItem
                    key={lang}
                    onSelect={() => {
                      if (lang !== currentLang) {
                        void switchLanguage?.(lang)
                      }
                    }}
                  >
                    <span className="w-4 text-gfs-accent-600">
                      {lang === currentLang ? "✓" : ""}
                    </span>
                    {LANG_NATIVE_LABEL[lang]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild aria-label={t("authentication:logOut")} size="icon" variant="ghost">
              <Link href={logoutHref} prefetch={false} title={t("authentication:logOut")}>
                <LogOutIcon size={16} strokeWidth={1.8} />
              </Link>
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}

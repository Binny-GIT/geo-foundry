"use client"

import "./nav-layout.css"

import { Link, useAuth, useConfig, useNav, useTranslation } from "@payloadcms/ui"
import { usePathname } from "next/navigation"
import { formatAdminURL } from "payload/shared"
import { type ComponentType, useEffect, useState } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide"
import { MorphIcon } from "morphicons/react"

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
import { ChevronDownIcon, LogOutIcon, MenuIcon, NAV_ICON_BY_SLUG, XIcon } from "../icons"
import type { IconProps } from "../icons"
import {
  CONSOLE_NAV,
  CONSOLE_RESOURCES,
  consoleRoute,
  type ConsoleNavItem,
} from "@/console/lib/resources"

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

const ZH_ROLE_LABEL: Readonly<Record<string, string>> = {
  "content-service": "内容服务",
  editor: "编辑",
  publisher: "发布",
  reviewer: "审阅",
  "super-admin": "超级管理员",
  "tenant-admin": "租户管理员",
}

export type UnifiedNavItem = Readonly<{
  readonly href: string
  readonly icon?: ComponentType<IconProps>
  readonly label: string
}>

type NavLinksProps = {
  readonly visibleSlugs: readonly string[]
}

const toUnifiedItems = (
  entries: readonly ConsoleNavItem[],
  visibleSlugs: readonly string[],
): readonly UnifiedNavItem[] =>
  entries.flatMap((entry): readonly UnifiedNavItem[] => {
    if (entry.kind === "static") {
      return [{ href: entry.href, icon: entry.icon, label: entry.label.zh }]
    }
    if (!visibleSlugs.includes(entry.slug)) {
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

export const NavLinks = ({ visibleSlugs }: NavLinksProps) => {
  const { hydrated, navOpen, navRef, setNavOpen, shouldAnimate } = useNav()
  const pathname = usePathname()
  const { i18n, switchLanguage, t } = useTranslation()
  const { config } = useConfig()
  const { user } = useAuth()
  const adminRoute = config.routes.admin
  const businessItems = toUnifiedItems(CONSOLE_NAV.business, visibleSlugs)
  const adminItems = toUnifiedItems(CONSOLE_NAV.admin, visibleSlugs)

  /*
   * Desktop icon-rail collapse. Payload's own `navOpen` only drives the
   * <=1440px drawer; this is a separate, persisted narrow mode for large
   * viewports. Initialized in an effect (not from localStorage during
   * render) so SSR markup and the first client render stay identical —
   * the width utility is applied afterwards as a pure style change.
   * Breakpoint-prefixed classes keep the collapsed width desktop-only:
   * in drawer mode the sidebar is either fully open or display:none.
   */
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("gf-nav-collapsed") === "1")
  }, [])
  /* Mirrors collapse state onto <html> so nav-layout.css can shrink Payload's
   * `--nav-width` grid track together with the rail (see that file). */
  useEffect(() => {
    document.documentElement.toggleAttribute("data-gf-nav-collapsed", collapsed)
  }, [collapsed])
  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      window.localStorage.setItem("gf-nav-collapsed", previous ? "0" : "1")
      return !previous
    })
  }

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
      collapsed && "min-[1441px]:justify-center min-[1441px]:gap-0 min-[1441px]:px-0",
    )

  const renderItem = (item: UnifiedNavItem) => {
    // Same active-link rule as Payload's own DefaultNavClient: an exact
    // segment match, not a loose prefix match. The dashboard is an exact
    // equality on top of that — otherwise every /admin/* route highlights it.
    const isActive =
      item.href === adminRoute
        ? pathname === item.href
        : pathname.startsWith(item.href) && ["/", undefined].includes(pathname[item.href.length])
    const Icon = item.icon
    const content = (
      <>
        {isActive && (
          <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gfs-accent-500" />
        )}
        {Icon !== undefined && <Icon size={17} strokeWidth={1.65} />}
        <span className={cn("truncate", collapsed && "min-[1441px]:hidden")}>{item.label}</span>
      </>
    )
    if (pathname === item.href) {
      return (
        <div className={linkClassName(isActive)} key={item.href} title={item.label}>
          {content}
        </div>
      )
    }
    return (
      <Link
        className={linkClassName(isActive)}
        href={item.href}
        key={item.href}
        prefetch={false}
        title={item.label}
      >
        {content}
      </Link>
    )
  }

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
          <MenuIcon size={18} strokeWidth={1.65} />
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
          collapsed && "min-[1441px]:w-[72px]",
          navOpen && "opacity-100",
          shouldAnimate && "transition-[opacity,width] duration-150 ease-in-out",
          hydrated && "gf-sidebar--hydrated",
        )}
        inert={!navOpen}
      >
        <div className="flex h-full flex-col bg-gfs-ink-900 text-white">
          <div
            className={cn(
              "flex items-center gap-2.5 px-5 pt-6 pb-5",
              collapsed && "min-[1441px]:justify-center min-[1441px]:gap-0 min-[1441px]:px-2",
            )}
          >
            <GeoIcon size={26} />
            <span
              className={cn(
                "flex-1 text-base font-bold tracking-tight",
                collapsed && "min-[1441px]:hidden",
              )}
            >
              Geo Foundry
            </span>
            {/* Desktop collapse toggle: narrows the sidebar to an icon rail.
             * Quiet by default, brightens on hover — it must read as a rail
             * control, not compete with the brand lockup next to it. */}
            <button
              aria-label={isZH ? "收起导航" : "Collapse navigation"}
              className={cn(
                "hidden size-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/12 hover:text-white min-[1441px]:flex",
                collapsed && "min-[1441px]:mt-3",
              )}
              onClick={toggleCollapsed}
              title={isZH ? "收起导航" : "Collapse navigation"}
              type="button"
            >
              {/*
               * Morphing collapse toggle (morphicons): the panel glyph glides
               * between its close/open chevron instead of hard-swapping SVGs.
               * Icon data comes from the lucide data package, matching the
               * shapes in components/icons.
               */}
              <MorphIcon
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                reducedMotion="user"
                size={16}
                spring="snappy"
                strokeWidth={1.7}
              />
            </button>
            {/* Close button: only needed where the nav is a drawer. */}
            <button
              aria-label={t("general:close") + " " + t("general:menu")}
              className="flex size-8 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white min-[1441px]:hidden"
              onClick={() => setNavOpen(false)}
              type="button"
            >
              <XIcon size={18} strokeWidth={1.65} />
            </button>
          </div>

          <Separator className="mx-5 w-auto bg-white/10" />

          <ScrollArea className="min-h-0 flex-1" viewportRef={navRef}>
            <nav className="flex flex-col gap-1 px-3 py-4">
              <div className="flex flex-col gap-0.5">{businessItems.map(renderItem)}</div>

              {adminItems.length > 0 && (
                <>
                  <Separator className="mx-2 my-4 w-auto bg-white/10" />
                  <div className="flex flex-col gap-0.5">{adminItems.map(renderItem)}</div>
                </>
              )}
            </nav>
          </ScrollArea>

          <Separator className="mx-5 w-auto bg-white/10" />

          <div
            className={cn(
              "flex items-center gap-2.5 px-5 py-4",
              collapsed &&
                "min-[1441px]:flex-col min-[1441px]:justify-center min-[1441px]:gap-2 min-[1441px]:px-2",
            )}
          >
            <Avatar className="bg-gfs-accent-500/20" title={email ?? undefined}>
              <AvatarFallback className="bg-transparent text-gfs-accent-300">
                {initialOf(email)}
              </AvatarFallback>
            </Avatar>
            <div className={cn("grid min-w-0 flex-1 gap-0.5", collapsed && "min-[1441px]:hidden")}>
              <strong className="truncate text-xs font-semibold text-white">
                {email ?? (isZH ? "账户" : "Account")}
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
             * footer, there is no room below it. Hidden in the collapsed
             * rail (72px); expand or use the account page to switch.
             */}
            <div className={cn(collapsed && "min-[1441px]:hidden")}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("general:language")}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white outline-none transition-colors hover:bg-white/20"
                >
                  {LANG_LABEL[currentLang]}
                  <ChevronDownIcon size={12} strokeWidth={1.8} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  {UI_LANGUAGES.map((lang) => (
                    <DropdownMenuItem
                      key={lang}
                      onSelect={() => {
                        if (lang !== currentLang) {
                          /*
                           * router.refresh() (inside switchLanguage) reliably
                           * re-renders client chrome, but server-rendered
                           * surfaces like the dashboard lag behind it —
                           * verified live: the dashboard only swapped after a
                           * full navigation. A hard reload after the cookie
                           * write guarantees the whole page swaps atomically.
                           */
                          void switchLanguage?.(lang).then(() => {
                            window.location.reload()
                          })
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
            </div>
            <Button asChild aria-label={t("authentication:logOut")} size="icon" variant="ghost">
              <Link href={logoutHref} prefetch={false} title={t("authentication:logOut")}>
                <LogOutIcon size={16} strokeWidth={1.65} />
              </Link>
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}

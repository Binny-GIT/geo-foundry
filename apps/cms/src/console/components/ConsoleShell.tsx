"use client"

import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide"
import { MorphIcon } from "morphicons/react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { GeoIcon } from "@/components/branding/GeoIcon"
import { ChevronDownIcon, LogOutIcon, MenuIcon, UserIcon, XIcon } from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  CONSOLE_NAV,
  CONSOLE_RESOURCES,
  type ConsoleNavItem,
  type ConsoleResourceSlug,
  consoleRoute,
} from "@/console/lib/resources"
import { cn } from "@/lib/utils"

export type ConsoleNavigation = {
  readonly resources: readonly ConsoleResourceSlug[]
  readonly session: {
    readonly email: string
    readonly roleLabel: string
    readonly tenantName: string | null
  }
}

const initialOf = (email: string) => email.slice(0, 1).toUpperCase() || "?"

type ResolvedNavItem = {
  readonly href: string
  readonly icon: (props: { readonly size?: number }) => React.JSX.Element
  readonly key: string
  readonly label: string
}

const resolveNavItems = (
  items: readonly ConsoleNavItem[],
  resources: readonly ConsoleResourceSlug[],
): readonly ResolvedNavItem[] =>
  items.flatMap((item) => {
    if (item.kind === "static") {
      return [{ href: item.href, icon: item.icon, key: item.href, label: item.label.zh }]
    }
    if (!resources.includes(item.slug)) return []
    const resource = CONSOLE_RESOURCES[item.slug]
    return [
      {
        href: consoleRoute.collection(item.slug),
        icon: resource.icon,
        key: item.slug,
        label: resource.label.zh,
      },
    ]
  })

export const ConsoleShell = ({
  children,
  navigation,
}: React.PropsWithChildren<{
  readonly navigation: ConsoleNavigation
}>) => {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("light")
  /*
   * Desktop icon-rail collapse, mirrored from the admin sidebar (same
   * localStorage key, so collapsing one shell collapses the other). Like
   * there, it is applied after mount so SSR and the first client render
   * stay identical.
   */
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("gf-nav-collapsed") === "1")
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      window.localStorage.setItem("gf-nav-collapsed", previous ? "0" : "1")
      return !previous
    })
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("gf-console-theme")
    const nextTheme = saved === "dark" ? "dark" : "light"
    setTheme(nextTheme)
    document.documentElement.dataset["consoleTheme"] = nextTheme
  }, [])

  const switchTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark"
    setTheme(nextTheme)
    window.localStorage.setItem("gf-console-theme", nextTheme)
    document.documentElement.dataset["consoleTheme"] = nextTheme
  }

  const logout = async () => {
    await fetch("/api/users/logout", { credentials: "same-origin", method: "POST" })
    router.replace(consoleRoute.login)
    router.refresh()
  }

  const linkClass = (active: boolean) =>
    cn(
      "gf-console-focus relative flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm no-underline transition-colors",
      active
        ? "bg-white/12 font-semibold text-white"
        : "text-white/65 hover:bg-white/7 hover:text-white",
      collapsed && "lg:justify-center lg:gap-0 lg:px-0",
    )

  const businessItems = resolveNavItems(CONSOLE_NAV.business, navigation.resources)
  const adminItems = resolveNavItems(CONSOLE_NAV.admin, navigation.resources)
  const isWorkbench = pathname === "/admin/work"

  const renderLink = (item: ResolvedNavItem) => {
    /*
     * Exact match for the dashboard href — a prefix match would keep
     * "控制台" lit on every /admin/* route.
     */
    const active =
      item.href === consoleRoute.dashboard
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    return (
      <Link
        className={linkClass(active)}
        href={item.href}
        key={item.key}
        onClick={() => setMenuOpen(false)}
        title={item.label}
      >
        {active && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-indigo-300" />}
        <item.icon size={18} />
        <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
      </Link>
    )
  }

  return (
    <div
      className={cn(
        "gf-console flex",
        isWorkbench ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen",
      )}
    >
      {menuOpen && (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      )}
      {/* `lg:top-0 lg:h-screen` matter: a sticky element without an explicit
       * top behaves like relative and scrolls away with the page. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[284px] -translate-x-full flex-col bg-[var(--console-sidebar)] text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          menuOpen && "translate-x-0",
          collapsed && "lg:w-[72px]",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4",
            collapsed && "lg:justify-center lg:gap-0 lg:px-2",
          )}
        >
          <GeoIcon size={22} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-bold tracking-tight",
              collapsed && "lg:hidden",
            )}
          >
            Geo Foundry
          </span>
          <button
            aria-label="关闭导航"
            className="gf-console-focus grid size-10 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <XIcon size={19} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <div className="grid gap-1">{businessItems.map(renderLink)}</div>
          {adminItems.length > 0 && (
            <>
              <div className="my-4 border-t border-white/10" />
              <div className="grid gap-1">{adminItems.map(renderLink)}</div>
            </>
          )}
        </nav>
        <div
          className={cn(
            "hidden shrink-0 justify-end border-t border-white/10 px-3 py-2.5 lg:flex",
            collapsed && "lg:justify-center",
          )}
        >
          <button
            aria-label={collapsed ? "展开导航" : "收起导航"}
            className="gf-console-focus flex size-8 cursor-pointer items-center justify-center rounded-xl bg-white/8 text-white/75 transition-colors hover:bg-white/16 hover:text-white"
            onClick={toggleCollapsed}
            title={collapsed ? "展开导航" : "收起导航"}
            type="button"
          >
            <MorphIcon
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              reducedMotion="user"
              size={17}
              spring="snappy"
              strokeWidth={1.7}
            />
          </button>
        </div>
      </aside>
      <div className={cn("min-w-0 flex-1", isWorkbench && "flex min-h-0 flex-col")}>
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--console-border)] bg-[color-mix(in_srgb,var(--console-canvas)_92%,transparent)] px-4 backdrop-blur lg:px-8">
          <button
            aria-label="打开导航"
            className="gf-console-focus grid size-9 place-items-center rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink)] lg:hidden"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <MenuIcon size={18} />
          </button>
          <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-[var(--console-ink)]">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--console-ink-muted)]">
              GF Studio
            </span>
            <span className="pl-2">内容运营管理中心</span>
          </p>
          {/* Theme toggle: the sun/moon glyph morphs (morphicons) between
           * modes; text-free icon button keeps the mobile header tight. */}
          <button
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            className="gf-console-focus flex size-9 items-center justify-center rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)]"
            onClick={switchTheme}
            title={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            type="button"
          >
            <MorphIcon
              icon={theme === "light" ? Moon : Sun}
              reducedMotion="user"
              size={17}
              spring="snappy"
              strokeWidth={1.6}
            />
          </button>
          {/*
           * Account menu (moved out of the sidebar footer): identity with
           * tenant scoping, account settings (password change lives there),
           * and logout — the same dropdown pattern as the admin sidebar.
           */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="账户选项"
              className="gf-console-focus flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2 pr-2.5 text-[var(--console-ink)] outline-none transition-colors hover:bg-[var(--console-surface-muted)]"
            >
              <span className="grid size-6 place-items-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-600">
                {initialOf(navigation.session.email)}
              </span>
              <span className="hidden max-w-[180px] truncate text-sm font-semibold sm:block">
                {navigation.session.email}
              </span>
              <ChevronDownIcon size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="grid gap-0.5 px-2.5 py-2">
                <strong className="truncate text-sm font-semibold text-slate-900">
                  {navigation.session.email}
                </strong>
                <span className="text-xs text-slate-500">
                  {navigation.session.roleLabel}
                  {navigation.session.tenantName === null
                    ? ""
                    : ` · 租户：${navigation.session.tenantName}`}
                </span>
              </div>
              <div className="my-1 h-px bg-slate-100" />
              <DropdownMenuItem asChild>
                <Link
                  className="flex cursor-pointer items-center gap-2 text-sm"
                  href={consoleRoute.account}
                >
                  <UserIcon size={15} /> 账户设置（修改密码）
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2 text-sm text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                onSelect={() => void logout()}
              >
                <LogOutIcon size={15} /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main
          className={cn(
            "w-full px-4 py-6 lg:px-8 lg:py-8",
            isWorkbench && "flex min-h-0 flex-1 flex-col overflow-hidden",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

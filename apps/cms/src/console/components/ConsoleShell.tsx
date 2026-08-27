"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { GeoIcon } from "@/components/branding/GeoIcon"
import {
  ChevronDownIcon,
  GlobeIcon,
  LayersIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons"
import {
  CONSOLE_GROUPS,
  CONSOLE_RESOURCES,
  consoleRoute,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"
import { cn } from "@/lib/utils"

export type ConsoleNavigation = {
  readonly canReadInbox: boolean
  readonly resources: readonly ConsoleResourceSlug[]
  readonly session: {
    readonly email: string
    readonly roleLabel: string
  }
}

const initialOf = (email: string) => email.slice(0, 1).toUpperCase() || "?"

export const ConsoleShell = ({ children, navigation }: React.PropsWithChildren<{
  readonly navigation: ConsoleNavigation
}>) => {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("light")

  useEffect(() => {
    const saved = window.localStorage.getItem("gf-console-theme")
    const nextTheme = saved === "dark" ? "dark" : "light"
    setTheme(nextTheme)
    document.documentElement.dataset["consoleTheme"] = nextTheme
  }, [])

  const switchTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light"
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
    )

  return (
    <div className="gf-console flex min-h-screen">
      {menuOpen && (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[284px] -translate-x-full flex-col bg-[var(--console-sidebar)] text-white transition-transform lg:sticky lg:translate-x-0",
          menuOpen && "translate-x-0",
        )}
      >
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5">
          <GeoIcon size={28} />
          <span className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">Geo Foundry</span>
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
          <Link
            className={linkClass(pathname === consoleRoute.dashboard)}
            href={consoleRoute.dashboard}
            onClick={() => setMenuOpen(false)}
          >
            <LayoutGridIcon size={18} />
            控制中心
          </Link>
          <section className="mt-6">
            <h2 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38">
              日常运营
            </h2>
            <div className="grid gap-1">
              <Link
                className={linkClass(pathname === "/admin/work" || pathname.startsWith("/admin/work/"))}
                href="/admin/work"
                onClick={() => setMenuOpen(false)}
              >
                <LayoutGridIcon size={18} />
                今日工作
              </Link>
              {navigation.canReadInbox && (
                <Link
                  className={linkClass(pathname === "/admin/inbox" || pathname.startsWith("/admin/inbox?"))}
                  href="/admin/inbox"
                  onClick={() => setMenuOpen(false)}
                >
                  <LayersIcon size={18} />
                  稿源箱
                </Link>
              )}
              <Link
                className={linkClass(pathname === consoleRoute.collection("content-editions"))}
                href={consoleRoute.collection("content-editions")}
                onClick={() => setMenuOpen(false)}
              >
                <SearchIcon size={18} />
                内容库
              </Link>
              <Link
                className={linkClass(pathname === consoleRoute.collection("sites"))}
                href={consoleRoute.collection("sites")}
                onClick={() => setMenuOpen(false)}
              >
                <GlobeIcon size={18} />
                品牌与站点
              </Link>
            </div>
          </section>
          {CONSOLE_GROUPS.map((group) => {
            const entries = navigation.resources
              .map((slug) => CONSOLE_RESOURCES[slug])
              .filter(
                (resource) =>
                  resource.group === group.key &&
                  !["content-editions", "sites"].includes(resource.apiSlug),
              )
            if (entries.length === 0) return null
            return (
              <section className="mt-6" key={group.key}>
                <h2 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38">
                  {group.label.zh}
                </h2>
                <div className="grid gap-1">
                  {entries.map((resource) => {
                    const href = consoleRoute.collection(resource.apiSlug)
                    const active = pathname === href || pathname.startsWith(`${href}/`)
                    const Icon = resource.icon
                    return (
                      <Link
                        className={linkClass(active)}
                        href={href}
                        key={resource.apiSlug}
                        onClick={() => setMenuOpen(false)}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-indigo-300" />}
                        <Icon size={18} />
                        <span className="truncate">{resource.label.zh}</span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-white/6 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-400/20 text-sm font-bold text-indigo-200">
              {initialOf(navigation.session.email)}
            </span>
            <Link className="min-w-0 flex-1 no-underline" href={consoleRoute.account}>
              <strong className="block truncate text-xs font-semibold">{navigation.session.email}</strong>
              <span className="block truncate pt-0.5 text-[11px] text-white/50">{navigation.session.roleLabel}</span>
            </Link>
            <button
              aria-label="账户选项"
              className="gf-console-focus grid size-8 place-items-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"
              onClick={switchTheme}
              title={theme === "light" ? "切换深色主题" : "切换浅色主题"}
              type="button"
            >
              <ChevronDownIcon size={15} />
            </button>
          </div>
          <button
            className="gf-console-focus mt-2 flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm text-white/60 transition-colors hover:bg-white/8 hover:text-white"
            onClick={() => void logout()}
            type="button"
          >
            <LogOutIcon size={17} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b border-[var(--console-border)] bg-[color-mix(in_srgb,var(--console-canvas)_92%,transparent)] px-4 backdrop-blur lg:px-8">
          <button
            aria-label="打开导航"
            className="gf-console-focus grid size-11 place-items-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink)] lg:hidden"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <MenuIcon size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--console-ink-muted)]">GF Studio</p>
            <p className="m-0 truncate pt-0.5 text-sm font-semibold text-[var(--console-ink)]">内容运营管理中心</p>
          </div>
          <button
            className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-xs font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)]"
            onClick={switchTheme}
            type="button"
          >
            {theme === "light" ? "深色" : "浅色"}
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}

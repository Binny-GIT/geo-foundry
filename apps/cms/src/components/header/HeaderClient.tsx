"use client"

import { getTranslation } from "@payloadcms/translations"
import { Link, useActions, useConfig, useNav, useStepNav, useTranslation } from "@payloadcms/ui"

import { GeoIcon } from "../branding/GeoIcon"
import { MenuIcon } from "../icons"

/**
 * Replaces Payload's stock AppHeader. Reproduces its three real
 * responsibilities from scratch (mobile nav toggle, StepNav breadcrumbs,
 * per-view action buttons) via the same public hooks the stock component
 * uses — `useNav`, `useStepNav`, `useActions` — so List/Edit views etc.
 * keep working unmodified; only the presentation changes. Deliberately
 * drops the stock account-avatar link: the sidebar footer (NavLinks.tsx)
 * already owns that identity block (avatar + email + role + sign-out).
 */
export const HeaderClient = () => {
  const { navOpen, setNavOpen } = useNav()
  const { stepNav } = useStepNav()
  const { Actions } = useActions()
  const { config } = useConfig()
  const { i18n, t } = useTranslation()
  const adminRoute = config.routes.admin
  const actionComponents = Object.values(Actions ?? {})

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button
        aria-label={`${t(navOpen ? "general:close" : "general:open")} ${t("general:menu")}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 min-[1441px]:hidden"
        onClick={() => setNavOpen(!navOpen)}
        type="button"
      >
        <MenuIcon size={18} strokeWidth={1.8} />
      </button>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-slate-500"
      >
        <Link
          className="flex shrink-0 items-center text-slate-400 no-underline transition-colors hover:text-slate-600"
          href={adminRoute}
          prefetch={false}
          title={t("general:dashboard")}
        >
          <GeoIcon size={16} />
        </Link>
        {stepNav.map((item, index) => {
          const label = getTranslation(item.label, i18n)
          const isLast = index === stepNav.length - 1
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: StepNav items have no stable id; Payload's own StepNav keys the same way.
            <span className="flex min-w-0 items-center gap-1.5" key={index}>
              <span className="text-slate-300">/</span>
              {isLast || item.url === undefined ? (
                <span
                  className={
                    isLast ? "truncate font-medium text-slate-900" : "truncate"
                  }
                >
                  {label}
                </span>
              ) : (
                <Link
                  className="truncate text-slate-500 no-underline transition-colors hover:text-slate-900"
                  href={item.url}
                  prefetch={false}
                >
                  {label}
                </Link>
              )}
            </span>
          )
        })}
      </nav>

      {actionComponents.length > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          {actionComponents.map((action, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Actions is a plain object keyed by internal action path, not exposed to us as a stable list key.
            <div key={index}>{action}</div>
          ))}
        </div>
      )}
    </header>
  )
}

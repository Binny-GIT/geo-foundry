"use client"

import "./legacy-app-header.css"

import { getTranslation } from "@payloadcms/translations"
import { Link, useActions, useConfig, useNav, useStepNav, useTranslation } from "@payloadcms/ui"

import { GeoIcon } from "../branding/GeoIcon"
import { MenuIcon } from "../icons"

/**
 * Global admin top bar. Owns the brand (icon + wordmark) — the sidebar
 * deliberately no longer repeats it, since this bar sits above the sidebar
 * and would otherwise double the logo in the top-left corner. Breadcrumbs
 * and per-view action buttons come from the same public hooks the stock
 * AppHeader used (`useStepNav`, `useActions`); List/Edit views keep writing
 * that data unmodified. The stock account avatar is intentionally dropped:
 * the sidebar footer owns identity (avatar + email + role + sign-out).
 */
export const HeaderClient = () => {
  const { navOpen, setNavOpen } = useNav()
  const { stepNav } = useStepNav()
  const { Actions } = useActions()
  const { config } = useConfig()
  const { i18n, t } = useTranslation()
  const adminRoute = config.routes.admin
  const actionComponents = Object.values(Actions ?? {})
  const hasCrumbs = stepNav.length > 0

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/75 sm:gap-4 sm:px-5">
      <button
        aria-label={`${t(navOpen ? "general:close" : "general:open")} ${t("general:menu")}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 min-[1441px]:hidden"
        onClick={() => setNavOpen(!navOpen)}
        type="button"
      >
        <MenuIcon size={18} strokeWidth={1.8} />
      </button>

      <Link
        className="flex shrink-0 items-center gap-2 text-slate-900 no-underline"
        href={adminRoute}
        prefetch={false}
        title={t("general:dashboard")}
      >
        <GeoIcon size={20} />
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
          Geo Foundry
        </span>
      </Link>

      {hasCrumbs && (
        <>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-slate-200" />
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
          >
            {stepNav.map((item, index) => {
              const label = getTranslation(item.label, i18n)
              const isLast = index === stepNav.length - 1
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: StepNav items have no stable id; Payload's own StepNav keys the same way.
                <span className="flex min-w-0 items-center gap-1.5" key={index}>
                  {index > 0 && <span className="text-slate-300">/</span>}
                  {isLast || item.url === undefined ? (
                    <span
                      className={
                        isLast
                          ? "truncate font-medium text-slate-900"
                          : "truncate text-slate-500"
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
        </>
      )}

      {!hasCrumbs && <div className="flex-1" />}

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

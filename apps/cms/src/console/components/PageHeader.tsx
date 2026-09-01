import type { ComponentType, ReactNode } from "react"

import type { IconProps } from "@/components/icons"

/**
 * Compact single-row page header shared by Console pages: optional glyph,
 * title and optional inline meta on the left, actions on the right. Keeps
 * vertical chrome small so the real content starts above the fold.
 */
export const PageHeader = ({
  actions,
  icon: Icon,
  meta,
  title,
}: {
  readonly actions?: ReactNode
  readonly icon?: ComponentType<IconProps> | undefined
  readonly meta?: ReactNode
  readonly title: ReactNode
}) => (
  <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {Icon !== undefined && (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600">
          <Icon size={18} />
        </span>
      )}
      <h1 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">{title}</h1>
      {meta !== undefined && meta !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{meta}</div>
      )}
    </div>
    {actions !== undefined && actions !== null && (
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    )}
  </header>
)

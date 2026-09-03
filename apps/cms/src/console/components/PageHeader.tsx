import type { ComponentType, ReactNode } from "react"

import type { IconProps } from "@/components/icons"

/**
 * Compact page meta/actions row for Console pages. The shared topbar owns the
 * page identity (icon + name as the document's h1), so this header no longer
 * renders a title — it keeps inline meta on the left and actions on the right.
 */
export const PageHeader = ({
  actions,
  icon: _icon,
  meta,
  title: _title,
}: {
  readonly actions?: ReactNode
  readonly icon?: ComponentType<IconProps> | undefined
  readonly meta?: ReactNode
  readonly title: ReactNode
}) => {
  void _icon
  void _title
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {meta !== undefined && meta !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{meta}</div>
      )}
      {actions !== undefined && actions !== null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

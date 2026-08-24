import type { ReactNode } from "react"

import type { Tone } from "./tone"

export type BadgeProps = {
  readonly children: ReactNode
  readonly tone?: Tone
}

/** A quiet status pill. Used for workflow status, site status, and the
 * "Restricted" permission state — never for real numeric metrics, so a
 * viewer can tell a status label apart from a count at a glance. */
export const Badge = ({ children, tone = "neutral" }: BadgeProps) => (
  <span className={`gf-ui-badge gf-ui-badge--${tone}`}>{children}</span>
)

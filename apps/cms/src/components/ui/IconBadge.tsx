import type { ReactNode } from "react"

import type { Tone } from "./tone"

export type IconBadgeProps = {
  readonly children: ReactNode
  readonly tone?: Tone
}

/** A fixed-size icon tile. Tone should reflect the panel's actual content —
 * a zero-count panel stays neutral so an empty queue never reads as an
 * active alert. */
export const IconBadge = ({ children, tone = "neutral" }: IconBadgeProps) => (
  <span className={`gf-ui-icon-badge gf-ui-icon-badge--${tone}`}>{children}</span>
)

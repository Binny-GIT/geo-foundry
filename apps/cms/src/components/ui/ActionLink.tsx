import type { AnchorHTMLAttributes } from "react"

export type ActionLinkVariant = "primary" | "secondary"

export type ActionLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly variant?: ActionLinkVariant
}

/** A link styled as a button. Every action group should have exactly one
 * "primary" link (the action most viewers want) and treat the rest as
 * "secondary", instead of rendering every link with equal visual weight. */
export const ActionLink = ({ variant = "secondary", ...rest }: ActionLinkProps) => (
  <a {...rest} className={`gf-ui-action-link gf-ui-action-link--${variant}`} />
)

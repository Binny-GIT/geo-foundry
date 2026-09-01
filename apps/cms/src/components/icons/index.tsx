import type { ComponentType } from "react"

export type IconProps = {
  readonly size?: number
  readonly strokeWidth?: number
}

const base = (size: number, strokeWidth: number) => ({
  fill: "none" as const,
  height: size,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth,
  viewBox: "0 0 24 24",
  width: size,
})

/** Draft / content authoring. */
export const PencilIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

/** Preview / document reading. */
export const EyeIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
)

/** Quality gate / review evidence. */
export const ShieldCheckIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

/** Immutable release / package. */
export const PackageIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
    <path d="m20.7 7-8.7-5-8.7 5v10l8.7 5 8.7-5Z" />
  </svg>
)

/** Awaiting review / search. */
export const SearchIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

/** Approved / passed. */
export const CheckCircleIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </svg>
)

/** Publish / send. */
export const SendIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" />
  </svg>
)

/** Failed / needs attention. */
export const AlertTriangleIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M10.3 3.9 2 19h20L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)

/** Roles / team. */
export const UsersIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

/** Published site / serving plane. */
export const GlobeIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </svg>
)

/** Control plane / stack. */
export const LayersIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="m12 2 10 5-10 5L2 7Z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </svg>
)

/** Tenant isolation / security. */
export const LockIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="11" width="18" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

/** Media library / uploaded asset. */
export const ImageIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="18" width="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </svg>
)

/** Canonical URL / routing record. */
export const LinkIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

/** Content edition / versioned document. */
export const CopyIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="13" width="13" x="8" y="8" rx="2" />
    <path d="M4.5 15.5A2 2 0 0 1 3 13.6V4.9a2 2 0 0 1 2-2h8.7a2 2 0 0 1 1.9 1.5" />
  </svg>
)

/** Rollback intent / revert to a prior release. */
export const RotateCcwIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
    <path d="M3 3v5h5" />
  </svg>
)

/** Sign out of the current session. */
export const LogOutIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
)

/** Mobile menu toggle (hamburger). */
export const MenuIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
)

/** Close / dismiss. */
export const XIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

/** Dashboard / home overview. */
export const LayoutGridIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="7" width="7" x="3" y="3" rx="1" />
    <rect height="7" width="7" x="14" y="3" rx="1" />
    <rect height="7" width="7" x="14" y="14" rx="1" />
    <rect height="7" width="7" x="3" y="14" rx="1" />
  </svg>
)

/** Inline hint / tooltip affordance. */
export const HelpCircleIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4" />
    <path d="M12 17.5h.01" />
  </svg>
)

/** Dropdown affordance. */
export const PlusIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
)

export const ChevronDownIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/** Sidebar collapse / expand toggles. */
export const PanelLeftCloseIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="18" rx="2" width="18" x="3" y="3" />
    <path d="M9 3v18" />
    <path d="m16 15-3-3 3-3" />
  </svg>
)

export const PanelLeftOpenIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <rect height="18" rx="2" width="18" x="3" y="3" />
    <path d="M9 3v18" />
    <path d="m14 9 3 3-3 3" />
  </svg>
)

export const PlugIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
)

export const InboxIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

export const FileClockIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M11.4 12H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" />
    <path d="M16 2v4h6" />
    <path d="M16 4h2a2 2 0 0 1 2 2v4h-6V4Z" />
    <circle cx="16" cy="18" r="4" />
    <path d="M16 16.5V18l1 1" />
  </svg>
)

export const NewspaperIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8" />
    <path d="M15 18h-5" />
    <path d="M10 6h8v4h-8V6Z" />
  </svg>
)

export const MessageSquareIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const CalendarClockIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h5" />
    <circle cx="17" cy="17" r="5" />
    <path d="M17 15v2h2" />
  </svg>
)

export const ChartLineIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
)

export const ChartBarIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M8 17v-5" />
    <path d="M13 17V8" />
    <path d="M18 17V5" />
  </svg>
)

export const KeyRoundIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M2.59 17.42A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r="0.5" fill="currentColor" />
  </svg>
)

/**
 * One nav icon per admin sidebar entry, keyed by collection slug. `sites`
 * and `domains` intentionally share GlobeIcon — a domain is a routing
 * attribute of a site, not a separate concept worth a second glyph.
 */
export const NAV_ICON_BY_SLUG: Readonly<Record<string, ComponentType<IconProps>>> = {
  "content-editions": CopyIcon,
  contents: PencilIcon,
  domains: GlobeIcon,
  media: ImageIcon,
  operations: LayersIcon,
  "quality-assessments": ShieldCheckIcon,
  releases: PackageIcon,
  "rollback-intents": RotateCcwIcon,
  sites: GlobeIcon,
  tenants: LockIcon,
  "url-records": LinkIcon,
  users: UsersIcon,
  // Intake and editorial-support collections.
  "article-sources": NewspaperIcon,
  connectors: PlugIcon,
  "intake-items": InboxIcon,
  "review-comments": MessageSquareIcon,
  "source-snapshots": FileClockIcon,
  // Release and analytics collections.
  "api-usage-dailies": ChartBarIcon,
  "outbox-events": SendIcon,
  "performance-snapshots": ChartLineIcon,
  "publication-plans": CalendarClockIcon,
  // Internal bookkeeping tables — hidden from most roles, one glyph for all.
  "edition-draft-restore-idempotency": KeyRoundIcon,
  "idempotency-records": KeyRoundIcon,
  "reviewer-edition-decision-idempotency": KeyRoundIcon,
}

/** AI / generation affordances. */
export const SparklesIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M9.9 15.5a2 2 0 0 0-1.4-1.4L2.3 12.5a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
  </svg>
)

/** New document. */
export const FilePlusIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M9 15h6" />
    <path d="M12 12v6" />
  </svg>
)

/** Light / dark theme toggles. */
export const SunIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.9 4.9 1.4 1.4" />
    <path d="m17.7 17.7 1.4 1.4" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.3 17.7-1.4 1.4" />
    <path d="m19.1 4.9-1.4 1.4" />
  </svg>
)

export const MoonIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
  </svg>
)

/** List filtering. */
export const FilterIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
  </svg>
)

/** Import / bring content in. */
export const ImportIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M12 17V3" />
    <path d="m6 11 6 6 6-6" />
    <path d="M19 21H5" />
  </svg>
)

/** Single account / profile. */
export const UserIcon = ({ size = 20, strokeWidth = 1.5 }: IconProps) => (
  <svg {...base(size, strokeWidth)} aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

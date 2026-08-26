import type { ReactNode } from "react"

import { ActionLink, Badge, IconBadge, type Tone } from "../ui"
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  LayersIcon,
  PackageIcon,
  SearchIcon,
  SendIcon,
} from "../icons"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"

export type WorkspaceLanguage = "en" | "zh"

export const workspaceText = (i18n?: HasLanguage): WorkspaceLanguage => uiLangOf(i18n?.language)

export const WORKSPACE_TEXT = {
  en: {
    allTenants: "All tenants",
    currentTenant: "Current tenant",
    deniedBody: "This workspace is available only to the human role that owns the work.",
    deniedHeading: "This workspace is not available to this identity",
    evidence: "Quality evidence",
    noItems: "There is no work in this queue.",
    operation: "Operation",
    openRecord: "Open record",
    release: "Release",
    scope: "Live · access-scoped",
    work: "My work",
  },
  zh: {
    allTenants: "全部租户",
    currentTenant: "当前租户",
    deniedBody: "此工作台仅对负责该项工作的人工角色开放。",
    deniedHeading: "此身份不可使用该工作台",
    evidence: "质量证据",
    noItems: "当前队列没有待处理工作。",
    operation: "操作",
    openRecord: "打开记录",
    release: "发布版本",
    scope: "实时 · 按权限范围",
    work: "我的工作",
  },
} as const

export const cardClass =
  "rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]"

export const WorkspaceShell = ({
  children,
  i18n,
  kicker,
  title,
}: {
  readonly children: ReactNode
  readonly i18n?: HasLanguage | undefined
  readonly kicker: string
  readonly title: string
}) => {
  const t = WORKSPACE_TEXT[workspaceText(i18n)]
  return (
    <main className="gf-command-dashboard mx-auto flex box-border w-full min-w-0 max-w-[1440px] flex-col gap-8 p-8 md:p-6">
      <header className={`${cardClass} flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between`}>
        <div>
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            {kicker}
          </p>
          <h1 className="m-0 mt-1 text-[30px] font-bold tracking-tight text-[var(--theme-text)]">
            {title}
          </h1>
        </div>
        <span className="rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
          {t.scope}
        </span>
      </header>
      {children}
    </main>
  )
}

export const WorkspaceDenied = ({ i18n }: { readonly i18n?: HasLanguage | undefined }) => {
  const t = WORKSPACE_TEXT[workspaceText(i18n)]
  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.deniedHeading}>
      <section className={`${cardClass} flex items-start gap-3 p-6`}>
        <IconBadge tone="neutral">
          <AlertTriangleIcon size={18} />
        </IconBadge>
        <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.deniedBody}</p>
      </section>
    </WorkspaceShell>
  )
}

export const WorkspaceEmpty = ({ i18n }: { readonly i18n?: HasLanguage | undefined }) => (
  <div className={`${cardClass} flex items-center gap-3 p-6`}>
    <IconBadge tone="success">
      <CheckCircleIcon size={18} />
    </IconBadge>
    <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
      {WORKSPACE_TEXT[workspaceText(i18n)].noItems}
    </p>
  </div>
)

export const workspaceIcon = (kind: "evidence" | "operation" | "release" | "work") => {
  switch (kind) {
    case "evidence":
      return SearchIcon
    case "operation":
      return LayersIcon
    case "release":
      return PackageIcon
    case "work":
      return SendIcon
  }
}

export const toneFor = (value: string): Tone => {
  if (["failed", "error", "configure"].includes(value)) return "danger"
  if (["review", "queued", "running", "generating"].includes(value)) return "warning"
  if (["published", "succeeded", "current", "ready"].includes(value)) return "success"
  if (["compiled", "approved", "publish"].includes(value)) return "accent"
  return "neutral"
}

export const WorkspaceAction = ({
  href,
  children,
  primary = false,
}: {
  readonly children: ReactNode
  readonly href: string
  readonly primary?: boolean
}) => (
  <ActionLink href={href} variant={primary ? "primary" : "secondary"}>
    {children}
  </ActionLink>
)

export const StatusBadge = ({ label, state }: { readonly label: string; readonly state: string }) => (
  <Badge tone={toneFor(state)}>{label}</Badge>
)

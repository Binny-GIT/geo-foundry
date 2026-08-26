import type { Payload } from "payload"

import { CMS_ROLE } from "../../access/roles"
import { recordsOf } from "../dashboard/operations-model"
import { AlertTriangleIcon, CheckCircleIcon, LayersIcon } from "../icons"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
import { checkRuntimeReadiness } from "../../readiness/runtime-readiness"
import { IconBadge } from "../ui"
import { workspaceUserOf, type WorkspaceServerContext } from "../workspaces/workspace-server-context"
import {
  cardClass,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type SystemDiagnosticsProps = WorkspaceServerContext & {
  readonly i18n?: HasLanguage
  readonly payload: Payload
}

const TEXT = {
  en: {
    dependencies: "Dependencies",
    diagnostics: "System diagnostics",
    failedOperations: "Failed operations",
    healthy: "Ready",
    notReady: "Not ready",
    protected: "This page intentionally omits configuration values, credentials, request payloads, and provider prompts.",
    readiness: "Control-plane readiness",
    risk: "Cross-tenant risk summary",
    rollback: "Pending rollback intents",
  },
  zh: {
    dependencies: "依赖项",
    diagnostics: "系统诊断",
    failedOperations: "失败的操作",
    healthy: "已就绪",
    notReady: "未就绪",
    protected: "此页面刻意不展示配置值、凭据、请求载荷或 Provider 提示词。",
    readiness: "控制面就绪状态",
    risk: "跨租户风险摘要",
    rollback: "待处理回滚意图",
  },
} as const

const status = (value: string, lang: "en" | "zh") =>
  value === "ready" ? (lang === "zh" ? "已就绪" : "Ready") : lang === "zh" ? "未就绪" : "Not ready"

export const SystemDiagnostics = async ({ i18n, initPageResult, payload, user }: SystemDiagnosticsProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const currentUser = workspaceUserOf({ initPageResult, user })
  if (currentUser?.role !== CMS_ROLE.SUPER_ADMIN) return <WorkspaceDenied i18n={i18n} />

  const [readiness, operationsResult, rollbackResult] = await Promise.all([
    checkRuntimeReadiness(process.env),
    payload.find({ collection: "operations", depth: 0, limit: 100, overrideAccess: false, ...(currentUser === undefined ? {} : { user: currentUser }), where: { state: { equals: "failed" } } }),
    payload.find({ collection: "rollback-intents", depth: 0, limit: 100, overrideAccess: false, ...(currentUser === undefined ? {} : { user: currentUser }) }),
  ])
  const failedOperations = recordsOf(operationsResult.docs)
  const pendingRollbacks = recordsOf(rollbackResult.docs).filter((row) => row["consumedAt"] === null || row["consumedAt"] === undefined)
  const dependencies = [
    ["PostgreSQL", readiness.dependencies.postgres.status],
    ["RustFS", readiness.dependencies.rustfs.status],
  ] as const

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.diagnostics}>
      <section className={`${cardClass} flex items-start gap-3 p-5`}>
        <IconBadge tone={readiness.status === "ready" ? "success" : "warning"}>{readiness.status === "ready" ? <CheckCircleIcon size={18} /> : <AlertTriangleIcon size={18} />}</IconBadge>
        <div><h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.readiness}</h2><p className="m-0 mt-1 text-sm text-[var(--theme-elevation-600)]">{t.protected}</p></div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <article className={`${cardClass} flex flex-col gap-4 p-5`}><h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.dependencies}</h2><ul className="m-0 flex list-none flex-col p-0">{dependencies.map(([name, dependencyStatus]) => <li className="flex items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] py-3 first:border-t-0 first:pt-0" key={name}><span className="text-sm font-semibold text-[var(--theme-text)]">{name}</span><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${dependencyStatus === "ready" ? "bg-[var(--gf-tone-success-bg)] text-[var(--gf-tone-success-fg)]" : "bg-[var(--gf-tone-warning-bg)] text-[var(--gf-tone-warning-fg)]"}`}>{status(dependencyStatus,lang)}</span></li>)}</ul></article>
        <article className={`${cardClass} flex flex-col gap-4 p-5`}><div className="flex items-center gap-3"><IconBadge tone={failedOperations.length > 0 || pendingRollbacks.length > 0 ? "warning" : "success"}><LayersIcon size={18} /></IconBadge><h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.risk}</h2></div><dl className="m-0 grid gap-3"><div className="flex items-center justify-between gap-3"><dt className="text-sm text-[var(--theme-elevation-600)]">{t.failedOperations}</dt><dd className="m-0 text-xl font-bold tabular-nums text-[var(--theme-text)]">{failedOperations.length}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-sm text-[var(--theme-elevation-600)]">{t.rollback}</dt><dd className="m-0 text-xl font-bold tabular-nums text-[var(--theme-text)]">{pendingRollbacks.length}</dd></div></dl><div className="flex flex-wrap gap-2"><WorkspaceAction href="/admin/collections/operations?where[state][equals]=failed">{t.failedOperations}</WorkspaceAction><WorkspaceAction href="/admin/collections/rollback-intents">{t.rollback}</WorkspaceAction></div></article>
      </section>
    </WorkspaceShell>
  )
}

import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { formatDate, idOf, recordsOf, stringOf } from "../dashboard/operations-model"
import { AlertTriangleIcon, CheckCircleIcon, LayersIcon } from "../icons"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
import { IconBadge } from "../ui"
import { operationTimelineDisplayOf } from "../workspaces/lifecycle-workspace-model"
import { operationStateLabel, operationTypeLabel, roleLabel } from "../workspaces/workspace-labels"
import {
  cardClass,
  StatusBadge,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type OperationDetailProps = {
  readonly i18n?: HasLanguage
  readonly params?: { readonly id?: string | readonly string[] | undefined }
  readonly payload: Payload
  readonly user?: { readonly role?: unknown }
}

const readableRoles = new Set<CmsRole>([
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const TEXT = {
  en: {
    activity: "Stage timeline",
    attempt: "Attempt",
    currentStage: "Current stage",
    details: "Operation details",
    failed: "This operation failed. Review the linked record before creating a new authorized attempt.",
    noTimeline: "No display-safe stage events are available for this operation.",
    operation: "Operation run",
    operationType: "Operation type",
    openLedger: "Open ledger record",
    state: "State",
    technical: "Raw request payloads and provider diagnostics are intentionally kept in the protected ledger record.",
  },
  zh: {
    activity: "阶段时间线",
    attempt: "尝试次数",
    currentStage: "当前阶段",
    details: "操作详情",
    failed: "该操作已失败。请先检查关联记录，再创建新的已授权尝试。",
    noTimeline: "此操作没有可安全展示的阶段事件。",
    operation: "操作运行详情",
    operationType: "操作类型",
    openLedger: "打开台账记录",
    state: "状态",
    technical: "原始请求载荷和 Provider 诊断信息仅保留在受保护的台账记录中。",
  },
} as const

const paramId = (params: OperationDetailProps["params"]): string | null => {
  const raw = params?.id
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string" && value.length > 0 ? value : null
}

export const OperationDetail = async ({ i18n, params, payload, user }: OperationDetailProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const role = user?.role as CmsRole | undefined
  const id = paramId(params)
  if (id === null || role === undefined || !readableRoles.has(role)) return <WorkspaceDenied i18n={i18n} />

  const result = await payload.find({
    collection: "operations",
    depth: 0,
    limit: 1,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    where: { id: { equals: id } },
  })
  const operation = recordsOf(result.docs)[0]
  if (operation === undefined) return <WorkspaceDenied i18n={i18n} />
  const display = operationTimelineDisplayOf(operation)
  if (display === null) return <WorkspaceDenied i18n={i18n} />

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.operation}>
      <section className={`${cardClass} flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between`}>
        <div className="flex items-start gap-3">
          <IconBadge tone={display.state === "failed" ? "danger" : display.state === "succeeded" ? "success" : "accent"}>
            <LayersIcon size={20} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.details}</p>
            <h2 className="m-0 mt-1 font-mono text-xl font-bold tracking-tight text-[var(--theme-text)]">{display.operationId}</h2>
          </div>
        </div>
        <StatusBadge label={operationStateLabel(display.state, lang)} state={display.state} />
      </section>

        <section className="grid gap-4 sm:grid-cols-4">

        {[
          [t.state, operationStateLabel(display.state, lang)],
          [t.operationType, operationTypeLabel(display.operationType, lang)],
          [t.currentStage, display.currentStage ?? "—"],
          [t.attempt, String(operation["attempt"] ?? "1")],
        ].map(([label, value]) => (
          <article className={`${cardClass} p-5`} key={label}>
            <p className="m-0 text-xs text-[var(--theme-elevation-600)]">{label}</p>
            <strong className="mt-2 block break-words text-lg text-[var(--theme-text)]">{value}</strong>
          </article>
        ))}
      </section>

      <section className={`${cardClass} flex flex-col gap-4 p-5`}>
        <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.activity}</h2>
        {display.timeline.length === 0 ? (
          <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.noTimeline}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {display.timeline.map((entry, index) => (
              <li className="flex gap-3 border-t border-[var(--theme-elevation-100)] py-3 first:border-t-0 first:pt-0" key={`${entry.action}-${entry.at}-${index}`}>
                <IconBadge tone={entry.outcome === "failed" ? "danger" : entry.outcome === "succeeded" ? "success" : "neutral"}>
                  {entry.outcome === "failed" ? <AlertTriangleIcon size={16} /> : <CheckCircleIcon size={16} />}
                </IconBadge>
                <div className="min-w-0"><strong className="block break-words text-sm text-[var(--theme-text)]">{entry.stage ?? entry.action}</strong><span className="mt-1 block text-xs text-[var(--theme-elevation-600)]">{entry.at === null ? "—" : formatDate(entry.at, lang)}{entry.actorRole === null ? "" : ` · ${roleLabel(entry.actorRole, lang)}`}</span></div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`${cardClass} flex flex-col gap-4 p-5`}>
        {display.state === "failed" && <p className="m-0 text-sm font-semibold text-[var(--theme-error-700)]">{t.failed}</p>}
        <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.technical}</p>
        <WorkspaceAction href={`/admin/collections/operations/${idOf(operation) ?? id}`} primary>{t.openLedger}</WorkspaceAction>
      </section>
    </WorkspaceShell>
  )
}

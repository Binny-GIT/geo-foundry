import type { Payload } from "payload"

import { CMS_ROLE } from "../../access/roles"
import { recordsOf } from "../dashboard/operations-model"
import { type HasLanguage, uiLangOf } from "../i18n/ui-lang"
import { workflowStatusLabel } from "../workflow/workflow-actions-model"
import { lifecycleWorkspaceQueues } from "../workspaces/lifecycle-workspace-model"
import {
  type WorkspaceServerContext,
  workspaceUserOf,
} from "../workspaces/workspace-server-context"
import {
  cardClass,
  StatusBadge,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceEmpty,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type WorkQueueProps = WorkspaceServerContext & {
  readonly i18n?: HasLanguage
  readonly payload: Payload
}

const ROLE_QUEUE = {
  [CMS_ROLE.EDITOR]: "editor",
  [CMS_ROLE.PUBLISHER]: "publisher",
  [CMS_ROLE.REVIEWER]: "reviewer",
} as const

type QueueRole = keyof typeof ROLE_QUEUE

const TEXT = {
  en: {
    editor: "Production queue",
    editorHint: "Drafts and active generation work that need editorial ownership.",
    publisher: "Publishing queue",
    publisherHint:
      "Approved editions waiting for compilation, plus compiled editions ready for release control.",
    reviewer: "Review queue",
    reviewerHint: "Editions waiting for an evidence-based review decision.",
    openRecord: "Open record",
    openWorkspace: "Open workspace",
    identifier: "ID",
    state: "State",
    updated: "Updated",
    work: "My work",
  },
  zh: {
    editor: "内容生产队列",
    editorHint: "需要编辑者处理的草稿与生成中内容。",
    publisher: "发布队列",
    publisherHint: "等待系统编译的已批准版本，以及可进入发布控制的已编译版本。",
    reviewer: "审核队列",
    reviewerHint: "等待基于质量证据作出审核决定的内容版本。",
    openRecord: "打开记录",
    openWorkspace: "打开工作台",
    identifier: "标识",
    state: "状态",
    updated: "更新时间",
    work: "我的工作",
  },
} as const

const safeFind = async (
  payload: Payload,
  user: WorkQueueProps["user"],
  collection: Parameters<Payload["find"]>[0]["collection"],
  options: Omit<Parameters<Payload["find"]>[0], "collection" | "overrideAccess" | "user"> = {},
) =>
  payload.find({
    collection,
    depth: 0,
    limit: 100,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    ...options,
  })

const dateOf = (value: string | null, lang: "en" | "zh") => {
  if (value === null) return lang === "zh" ? "最近" : "Recently"
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return lang === "zh" ? "最近" : "Recently"
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date)
}

export const WorkQueue = async ({ i18n, initPageResult, payload, user }: WorkQueueProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const currentUser = workspaceUserOf({ initPageResult, user })
  const role = currentUser?.role
  if (typeof role !== "string" || !(role in ROLE_QUEUE)) return <WorkspaceDenied i18n={i18n} />

  const queueRole = role as QueueRole
  const editionsResult = await safeFind(payload, currentUser, "content-editions", {
    draft: true,
    sort: "-updatedAt",
  })
  const editions = recordsOf(editionsResult.docs)
  const queue = lifecycleWorkspaceQueues(editions)[ROLE_QUEUE[queueRole]]
  const roleTitle = t[ROLE_QUEUE[queueRole]]
  const roleHint =
    queueRole === CMS_ROLE.EDITOR
      ? t.editorHint
      : queueRole === CMS_ROLE.REVIEWER
        ? t.reviewerHint
        : t.publisherHint

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.work}>
      <section className={`${cardClass} flex flex-col gap-2 p-5`}>
        <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--theme-text)]">
          {roleTitle}
        </h2>
        <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{roleHint}</p>
      </section>

      {queue.length === 0 ? (
        <WorkspaceEmpty i18n={i18n} />
      ) : (
        <section aria-label={roleTitle} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {queue.map((edition) => (
            <article
              className={`${cardClass} flex min-w-0 flex-col gap-4 p-5`}
              key={edition.editionId}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-base font-bold text-[var(--theme-text)]">
                    {edition.title ??
                      `${lang === "zh" ? "内容版本" : "Edition"} ${edition.editionId}`}
                  </h3>
                  <p className="m-0 mt-1 text-xs text-[var(--theme-elevation-600)]">
                    {t.updated} · {dateOf(edition.updatedAt, lang)}
                  </p>
                </div>
                <StatusBadge
                  label={workflowStatusLabel(edition.workflowStatus, lang)}
                  state={edition.workflowStatus}
                />
              </div>
              <dl className="m-0 grid grid-cols-2 gap-3 border-t border-[var(--theme-elevation-100)] pt-3">
                <div>
                  <dt className="text-xs text-[var(--theme-elevation-600)]">{t.state}</dt>
                  <dd className="m-0 mt-1 text-sm font-semibold text-[var(--theme-text)]">
                    {workflowStatusLabel(edition.workflowStatus, lang)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--theme-elevation-600)]">{t.identifier}</dt>
                  <dd className="m-0 mt-1 truncate font-mono text-sm text-[var(--theme-text)]">
                    {edition.editionId}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <WorkspaceAction href={`/admin/work/editions/${edition.editionId}`} primary>
                  {t.openWorkspace}
                </WorkspaceAction>
                <WorkspaceAction href={`/admin/collections/content-editions/${edition.editionId}`}>
                  {t.openRecord}
                </WorkspaceAction>
              </div>
            </article>
          ))}
        </section>
      )}
    </WorkspaceShell>
  )
}

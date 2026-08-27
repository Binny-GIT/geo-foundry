"use client"

import { toast, useAuth, useDocumentInfo, useFormFields, useTranslation } from "@payloadcms/ui"
import { useEffect, useState } from "react"

import { CopyIcon, LinkIcon, UsersIcon } from "../icons"
import { uiLangOf } from "../i18n/ui-lang"
import { IconBadge } from "../ui"
import { ContentEditionRail, type VersionSelection } from "./ContentEditionRail"

type WorkspaceContext = Readonly<{
  assignees: readonly Readonly<{ email: string | null; id: number | null; role: string | null }>[]
  comments: readonly Readonly<{
    author: Readonly<{ email: string | null; id: number | null }>
    body: string | null
    createdAt: string | null
    id: number | null
    kind: string | null
    workflowRevision: number | null
  }>[]
  quality: Readonly<{
    createdAt: string | null
    inputHash: string | null
    issues: readonly unknown[]
    overall: number | null
    state: string | null
  }> | null
  sources: readonly Readonly<{
    id: number | null
    note: string | null
    role: string | null
    intakeItem: Readonly<{ id: number | null; sourceUrl: string | null; status: string | null; title: string | null }>
  }>[]
}>

const EMPTY: WorkspaceContext = { assignees: [], comments: [], quality: null, sources: [] }

const COPY = {
  en: {
    addComment: "Add comment",
    addSource: "Add source",
    comment: "Comment",
    commentPlaceholder: "Add editorial feedback for this version…",
    comments: "Review comments",
    history: "Version history",
    intakeId: "Intake item ID",
    loading: "Loading workspace context…",
    noComments: "No review comments yet.",
    noSources: "No linked sources yet.",
    sourceRole: "Source role",
    sources: "Sources",
    supporting: "Supporting",
    primary: "Primary",
  },
  zh: {
    addComment: "添加评论",
    addSource: "关联来源",
    comment: "评论",
    commentPlaceholder: "为当前版本添加编辑意见…",
    comments: "审核评论",
    history: "版本历史",
    intakeId: "稿源条目 ID",
    loading: "正在加载工作台上下文…",
    noComments: "暂时没有审核评论。",
    noSources: "暂时没有关联来源。",
    sourceRole: "来源角色",
    sources: "来源",
    supporting: "辅助来源",
    primary: "主要来源",
  },
} as const

const dateOf = (value: string | null, language: string): string => {
  if (value === null) return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString(language === "zh" ? "zh-CN" : "en-US")
}

export const ContentEditionContextRail = ({
  onSelectVersion,
  selectedVersion,
}: {
  readonly onSelectVersion: (version: VersionSelection) => void
  readonly selectedVersion: VersionSelection
}) => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const t = COPY[lang]
  const workflowRevision = useFormFields(([fields]) => fields["workflowRevision"]?.value)
  const [context, setContext] = useState<WorkspaceContext>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [intakeItemId, setIntakeItemId] = useState("")
  const [sourceRole, setSourceRole] = useState<"primary" | "supporting">("supporting")
  const [comment, setComment] = useState("")

  const reload = () => {
    if (id === undefined || id === null) return
    setLoading(true)
    void fetch(`/api/workspaces/editions/${id}/context`, {
      credentials: "same-origin",
      headers: { "x-request-id": crypto.randomUUID() },
    })
      .then(async (response) => (response.ok ? (await response.json()) as WorkspaceContext : EMPTY))
      .then(setContext)
      .catch(() => setContext(EMPTY))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [id])

  const addSource = async () => {
    if (id === undefined || id === null || !/^\d+$/.test(intakeItemId.trim())) return
    const response = await fetch(`/api/editions/${id}/article-sources`, {
      body: JSON.stringify({ intakeItemId: Number(intakeItemId), role: sourceRole }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "关联来源失败。" : "Could not link source.")
      return
    }
    setIntakeItemId("")
    reload()
  }

  const addComment = async () => {
    if (id === undefined || id === null || comment.trim().length === 0) return
    const response = await fetch(`/api/editions/${id}/review-comments`, {
      body: JSON.stringify({
        body: comment.trim(),
        ...(typeof workflowRevision === "number" ? { workflowRevision } : {}),
      }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "添加评论失败。" : "Could not add comment.")
      return
    }
    setComment("")
    reload()
  }

  const canEditSources = user?.["role"] === "editor" || user?.["role"] === "tenant-admin"
  const canComment = user?.["role"] === "editor" || user?.["role"] === "reviewer" || user?.["role"] === "tenant-admin"

  return (
    <aside aria-label={lang === "zh" ? "来源、评论和版本历史" : "Sources, comments, and version history"} className="grid min-w-0 content-start gap-4">
      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3"><IconBadge tone="accent"><LinkIcon size={18} /></IconBadge><div><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.sources}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">{context.sources.length}</strong></div></div>
        {loading ? <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.loading}</p> : context.sources.length === 0 ? <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noSources}</p> : <ul className="m-0 mt-4 grid list-none gap-3 p-0">{context.sources.map((source, index) => <li className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3" key={source.id ?? index}><p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">{source.role ?? "supporting"}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">{source.intakeItem.title ?? "—"}</strong>{source.intakeItem.sourceUrl !== null && <a className="mt-1 block truncate text-xs font-semibold text-[var(--gf-accent-700)] hover:underline" href={source.intakeItem.sourceUrl} rel="noreferrer" target="_blank">{source.intakeItem.sourceUrl}</a>}{source.note !== null && <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">{source.note}</p>}</li>)}</ul>}
        {canEditSources && id !== undefined && id !== null && <div className="mt-4 grid gap-2 border-t border-[var(--theme-elevation-150)] pt-4"><input aria-label={t.intakeId} className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]" onChange={(event) => setIntakeItemId(event.target.value)} placeholder={t.intakeId} value={intakeItemId} /><div className="grid grid-cols-[1fr_auto] gap-2"><select aria-label={t.sourceRole} className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]" onChange={(event) => setSourceRole(event.target.value as "primary" | "supporting")} value={sourceRole}><option value="supporting">{t.supporting}</option><option value="primary">{t.primary}</option></select><button className="min-h-10 rounded-lg bg-[var(--gf-accent-600)] px-3 text-sm font-bold text-white disabled:opacity-60" disabled={intakeItemId.trim().length === 0} onClick={() => void addSource()} type="button">{t.addSource}</button></div></div>}
      </section>

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3"><IconBadge tone="neutral"><UsersIcon size={18} /></IconBadge><div><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.comments}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">{context.comments.length}</strong></div></div>
        {context.comments.length === 0 ? <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noComments}</p> : <ul className="m-0 mt-4 grid list-none gap-3 p-0">{context.comments.map((entry, index) => <li className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3" key={entry.id ?? index}><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-[var(--theme-text)]">{entry.author.email ?? "—"}</strong><span className="text-[11px] text-[var(--theme-elevation-600)]">{dateOf(entry.createdAt, lang)}</span></div><p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--theme-elevation-700)]">{entry.body ?? "—"}</p></li>)}</ul>}
        {canComment && id !== undefined && id !== null && <div className="mt-4 border-t border-[var(--theme-elevation-150)] pt-4"><label className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]" htmlFor="edition-review-comment">{t.comment}</label><textarea className="mt-2 min-h-20 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm text-[var(--theme-text)]" id="edition-review-comment" maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder={t.commentPlaceholder} value={comment} /><button className="mt-2 min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-100)] px-3 text-sm font-bold text-[var(--theme-text)] disabled:opacity-60" disabled={comment.trim().length === 0} onClick={() => void addComment()} type="button">{t.addComment}</button></div>}
      </section>

      <ContentEditionRail onSelectVersion={onSelectVersion} selectedVersion={selectedVersion} showWorkflow={false} />
    </aside>
  )
}

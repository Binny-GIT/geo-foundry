"use client"

import { toast, useAuth, useDocumentInfo, useFormFields, useTranslation } from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import { useEffect, useId, useState } from "react"

import { CopyIcon, LayersIcon, RotateCcwIcon } from "../icons"
import { IconBadge } from "../ui"
import { uiLangOf } from "../i18n/ui-lang"
import { workflowStatusLabel, isWorkflowStatus } from "../workflow/workflow-actions-model"
import { WorkflowActions } from "../workflow/WorkflowActions"
import type { EditionVersionHistoryItem } from "../../services/edition-version-history"

const TEXT = {
  en: {
    api: "Document API",
    apiHint: "Browser-safe record summary. It never exposes internal service routes, credentials, or raw audit data.",
    current: "Current document",
    history: "Version history",
    loading: "Loading versions…",
    noVersions: "No saved versions are visible yet.",
    restore: "Restore as draft",
    restoreConfirm: "Restore selected version",
    restoreHint: "This copies editable content into a new current draft. It never overwrites the historical version or a published release.",
    restoreReason: "Restore reason",
    restoreReasonRequired: "Add a reason before restoring this version.",
    restoring: "Restoring…",
    selected: "Historical version selected",
    status: "Workflow",
    version: "Version",
  },
  zh: {
    api: "文档接口摘要",
    apiHint: "仅展示浏览器可安全读取的文档摘要，不包含内部服务路由、凭据或原始审计数据。",
    current: "当前文档",
    history: "版本历史",
    loading: "正在加载版本…",
    noVersions: "暂时没有可见的已保存版本。",
    restore: "恢复为新草稿",
    restoreConfirm: "确认恢复所选版本",
    restoreHint: "此操作会把可编辑内容复制为新的当前草稿，不会覆盖历史版本或已发布制品。",
    restoreReason: "恢复原因",
    restoreReasonRequired: "恢复前请填写原因。",
    restoring: "正在恢复…",
    selected: "已选择历史版本",
    status: "工作流",
    version: "版本",
  },
} as const

export type VersionSelection = EditionVersionHistoryItem | null

export const ContentEditionRail = ({
  onSelectVersion,
  selectedVersion,
  showWorkflow = true,
}: {
  readonly onSelectVersion: (version: VersionSelection) => void
  readonly selectedVersion: VersionSelection
  readonly showWorkflow?: boolean
}) => {
  const { user } = useAuth()
  const { data, id, versionCount } = useDocumentInfo()
  const { i18n } = useTranslation()
  const router = useRouter()
  const lang = uiLangOf(i18n.language)
  const t = TEXT[lang]
  const workflowStatus = useFormFields(([fields]) => fields["workflowStatus"]?.value)
  const workflowRevision = useFormFields(([fields]) => fields["workflowRevision"]?.value)
  const updatedAt = typeof data?.["updatedAt"] === "string" ? data["updatedAt"] : null
  const [versions, setVersions] = useState<readonly EditionVersionHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const reasonId = useId()
  const canRestore =
    user?.["role"] === "editor" && selectedVersion !== null && workflowStatus === "draft"

  useEffect(() => {
    if (id === undefined || id === null) return
    const controller = new AbortController()
    setLoading(true)
    void fetch(`/api/workspaces/editions/${id}/version-history`, {
      credentials: "same-origin",
      headers: { "x-request-id": crypto.randomUUID() },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return [] as readonly EditionVersionHistoryItem[]
        const body = (await response.json()) as { versions?: readonly EditionVersionHistoryItem[] }
        return body.versions ?? []
      })
      .then((next) => setVersions(next))
      .catch(() => undefined)
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [id, versionCount])

  const restore = async () => {
    if (id === undefined || id === null || selectedVersion === null) return
    const normalizedReason = reason.trim()
    if (normalizedReason.length === 0) {
      setReasonError(t.restoreReasonRequired)
      return
    }
    if (typeof workflowRevision !== "number" || typeof updatedAt !== "string") {
      toast.error(lang === "zh" ? "当前草稿状态不可恢复，请刷新后重试。" : "Current draft state is unavailable. Refresh and retry.")
      return
    }
    setRestoring(true)
    try {
      const response = await fetch(`/api/workspaces/editions/${id}/restore-draft`, {
        body: JSON.stringify({
          expectedRevision: workflowRevision,
          expectedUpdatedAt: updatedAt,
          reason: normalizedReason,
          versionId: selectedVersion.id,
        }),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        method: "POST",
      })
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } }
      if (!response.ok) {
        const message =
          body.error?.code === "EDITION_WORKFLOW_REVISION_CONFLICT" ||
          body.error?.code === "EDITION_DRAFT_RESTORE_STALE"
            ? lang === "zh"
              ? "当前草稿已发生变化，请刷新后重试。"
              : "The current draft changed. Refresh and retry."
            : lang === "zh"
              ? "恢复草稿失败。"
              : "Draft restore failed."
        throw new Error(message)
      }
      toast.success(lang === "zh" ? "已从历史版本恢复新的草稿。" : "A new draft was restored from history.")
      setRestoreOpen(false)
      setReason("")
      setReasonError(null)
      onSelectVersion(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.restoreHint)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <aside className="grid min-w-0 content-start gap-4">
      {showWorkflow && <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone="accent"><LayersIcon size={18} /></IconBadge>
          <div><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.status}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">{isWorkflowStatus(workflowStatus) ? workflowStatusLabel(workflowStatus, i18n.language) : "—"}</strong></div>
        </div>
        <div className="mt-4"><WorkflowActions /></div>
      </section>}

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3"><IconBadge tone="neutral"><CopyIcon size={18} /></IconBadge><div><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.history}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">{versionCount} {t.version}</strong></div></div>
        {loading ? <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.loading}</p> : versions.length === 0 ? <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noVersions}</p> : <ol className="m-0 mt-4 flex list-none flex-col p-0">{versions.map((version) => <li className="border-t border-[var(--theme-elevation-100)] py-3 first:border-t-0 first:pt-0" key={version.id}><button className={`w-full rounded-lg p-2 text-left transition ${selectedVersion?.id === version.id ? "bg-[var(--gf-tone-accent-bg)]" : "hover:bg-[var(--theme-elevation-50)]"}`} onClick={() => onSelectVersion(selectedVersion?.id === version.id ? null : version)} type="button"><span className="block text-sm font-bold text-[var(--theme-text)]">{isWorkflowStatus(version.workflowStatus) ? workflowStatusLabel(version.workflowStatus, i18n.language) : lang === "zh" ? "已保存版本" : "Saved version"}</span><span className="mt-1 block text-xs text-[var(--theme-elevation-600)]">{new Date(version.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</span></button></li>)}</ol>}
        {selectedVersion !== null && <div className="mt-4 rounded-xl border border-[var(--gf-tone-warning-fg)] bg-[var(--gf-tone-warning-bg)] p-3"><p className="m-0 text-sm font-bold text-[var(--gf-tone-warning-fg)]">{t.selected}</p>{canRestore && <button className="mt-3 min-h-11 w-full rounded-lg bg-[var(--gf-accent-600)] px-3 text-sm font-bold text-white hover:bg-[var(--gf-accent-700)]" onClick={() => setRestoreOpen(true)} type="button">{t.restore}</button>}</div>}
      </section>

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3"><IconBadge tone="neutral"><RotateCcwIcon size={18} /></IconBadge><div><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.api}</p><strong className="mt-1 block text-sm text-[var(--theme-text)]">Content Editions · {id ?? "new"}</strong></div></div>
        <p className="m-0 mt-3 text-xs leading-5 text-[var(--theme-elevation-600)]">{t.apiHint}</p>
      </section>

      {restoreOpen && selectedVersion !== null && <div aria-labelledby={`${reasonId}-title`} aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog"><div className="w-full max-w-lg rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-6 shadow-2xl"><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.history}</p><h2 className="m-0 mt-1 text-xl font-bold tracking-tight text-[var(--theme-text)]" id={`${reasonId}-title`}>{t.restoreConfirm}</h2><p className="m-0 mt-3 text-sm leading-6 text-[var(--theme-elevation-700)]">{t.restoreHint}</p><label className="mt-5 block" htmlFor={reasonId}><span className="text-sm font-bold text-[var(--theme-text)]">{t.restoreReason} *</span><textarea aria-invalid={reasonError !== null} className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-500)] focus:ring-2 focus:ring-[var(--gf-accent-200)]" id={reasonId} maxLength={500} onChange={(event) => { setReason(event.target.value); setReasonError(null) }} value={reason} />{reasonError !== null && <span className="mt-1 block text-xs font-semibold text-[var(--theme-error-700)]">{reasonError}</span>}</label><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="min-h-11 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-100)] px-4 text-sm font-bold text-[var(--theme-text)]" disabled={restoring} onClick={() => setRestoreOpen(false)} type="button">{lang === "zh" ? "取消" : "Cancel"}</button><button className="min-h-11 rounded-lg bg-[var(--gf-accent-600)] px-4 text-sm font-bold text-white disabled:opacity-70" disabled={restoring} onClick={() => void restore()} type="button">{restoring ? t.restoring : t.restoreConfirm}</button></div></div></div>}
    </aside>
  )
}

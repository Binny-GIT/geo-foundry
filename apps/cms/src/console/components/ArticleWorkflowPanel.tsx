"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  isWorkflowStatus,
  workflowActionsFor,
  type WorkflowAction,
} from "@/components/workflow/workflow-actions-model"
import {
  editionActionErrorMessage,
  editionCommentEndpointOf,
  editionEvaluationEndpointOf,
  editionWorkflowEndpointOf,
  publicationPlanEndpoint,
} from "@/console/lib/edition-workflow-client"

/**
 * Article detail action panel: the same protected workflow endpoints the
 * workbench board uses (status transitions, quality evaluation, publication
 * scheduling) plus the review comment endpoint — so a publisher/reviewer can
 * operate on an article without leaving its detail page.
 */
const ArticleWorkflowPanel = ({
  editionId,
  role,
  siteTimezone,
  title,
  workflowRevision,
  workflowStatus,
}: {
  readonly editionId: number
  readonly role: string
  readonly siteTimezone: string | null
  readonly title: string
  readonly workflowRevision: number
  readonly workflowStatus: string
}) => {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [confirming, setConfirming] = useState<WorkflowAction | null>(null)
  const [reason, setReason] = useState("")
  const [scheduling, setScheduling] = useState(false)
  const [scheduledFor, setScheduledFor] = useState("")
  const [comment, setComment] = useState("")

  const actions = isWorkflowStatus(workflowStatus)
    ? workflowActionsFor(role, workflowStatus, "zh")
    : []

  const runAction = async (action: WorkflowAction, auditReason?: string) => {
    setPending(action.label)
    setNotice(null)
    try {
      const reviewerDecision =
        action.type === "reviewer-approve" || action.type === "reviewer-request-changes"
      const normalizedReason = auditReason?.trim()
      const response = await fetch(editionWorkflowEndpointOf(action, editionId), {
        body: JSON.stringify({
          ...(action.type === "transition" ? { target: action.target } : {}),
          ...(reviewerDecision ? { expectedRevision: workflowRevision } : {}),
          ...(normalizedReason === undefined || normalizedReason.length === 0
            ? {}
            : { reason: normalizedReason }),
        }),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(reviewerDecision
            ? { "idempotency-key": crypto.randomUUID(), "x-request-id": crypto.randomUUID() }
            : {}),
        },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
      if (!response.ok) throw new Error(editionActionErrorMessage(result.error?.code))
      setConfirming(null)
      setReason("")
      setNotice({ ok: true, text: `${action.label}已完成` })
      router.refresh()
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : editionActionErrorMessage(undefined),
      })
    } finally {
      setPending(null)
    }
  }

  const runQuality = async () => {
    setPending("quality")
    setNotice(null)
    try {
      const response = await fetch(editionEvaluationEndpointOf(editionId), {
        body: JSON.stringify({}),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        method: "POST",
      })
      if (!response.ok) throw new Error(editionActionErrorMessage(undefined))
      setNotice({ ok: true, text: "已提交质量检查" })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "提交质量检查失败。" })
    } finally {
      setPending(null)
    }
  }

  const submitSchedule = async () => {
    if (scheduledFor.length === 0) return
    setPending("schedule")
    setNotice(null)
    try {
      const response = await fetch(publicationPlanEndpoint, {
        body: JSON.stringify({
          editionId,
          scheduledFor: new Date(scheduledFor).toISOString(),
          timezone: siteTimezone ?? "UTC",
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error("创建发布排期失败。")
      setScheduling(false)
      setScheduledFor("")
      setNotice({ ok: true, text: "已创建发布排期" })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "创建发布排期失败。" })
    } finally {
      setPending(null)
    }
  }

  const submitComment = async () => {
    const trimmed = comment.trim()
    if (trimmed.length === 0) return
    setPending("comment")
    setNotice(null)
    try {
      const response = await fetch(editionCommentEndpointOf(editionId), {
        body: JSON.stringify({ body: trimmed }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error("评论提交失败，请确认权限后重试。")
      setComment("")
      setNotice({ ok: true, text: "评论已添加" })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "评论提交失败。" })
    } finally {
      setPending(null)
    }
  }

  const showQuality =
    role === "editor" && ["draft", "generating", "review"].includes(workflowStatus)
  const showSchedule =
    role === "publisher" && ["approved", "compiled"].includes(workflowStatus)
  const hasActions = actions.length > 0 || showQuality || showSchedule

  return (
    <section className="gf-console-card grid gap-4 p-5">
      <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">操作</h2>

      {notice !== null && (
        <p
          className={`m-0 rounded-xl border px-3.5 py-2.5 text-sm ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {hasActions ? (
        <div className="grid gap-2 border-t border-[var(--console-border)] pt-4 sm:grid-cols-2">
          {actions.map((action) => (
            <button
              className={`gf-console-focus h-9 rounded-xl px-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
                action.tone === "primary"
                  ? "bg-[var(--console-accent)] text-white hover:bg-[var(--console-accent-hover)]"
                  : "border border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)]"
              }`}
              disabled={pending !== null}
              key={action.label}
              onClick={() => {
                if (action.confirm === true || action.reasonRequired === true) {
                  setConfirming(action)
                  setReason("")
                  return
                }
                void runAction(action)
              }}
              type="button"
            >
              {pending === action.label ? "…" : action.label}
            </button>
          ))}
          {showQuality && (
            <button
              className="gf-console-focus h-9 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)] disabled:cursor-wait disabled:opacity-60"
              disabled={pending !== null}
              onClick={() => void runQuality()}
              type="button"
            >
              {pending === "quality" ? "…" : "质量检查"}
            </button>
          )}
          {showSchedule && (
            <button
              className="gf-console-focus h-9 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)] disabled:cursor-wait disabled:opacity-60"
              disabled={pending !== null}
              onClick={() => {
                setScheduling(true)
                setScheduledFor("")
              }}
              type="button"
            >
              创建发布排期
            </button>
          )}
        </div>
      ) : (
        <p className="m-0 border-t border-[var(--console-border)] pt-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          当前角色在此状态下没有可执行的操作。
        </p>
      )}

      <div className="grid gap-2 border-t border-[var(--console-border)] pt-4">
        <label className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]" htmlFor="article-comment">
          添加评论
        </label>
        <textarea
          className="gf-console-focus min-h-20 w-full resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink)]"
          id="article-comment"
          maxLength={2000}
          onChange={(event) => setComment(event.target.value)}
          placeholder="评审意见会与文章历史一起保存…"
          value={comment}
        />
        <button
          className="gf-console-focus h-9 rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--console-accent-hover)] disabled:opacity-60"
          disabled={pending !== null || comment.trim().length === 0}
          onClick={() => void submitComment()}
          type="button"
        >
          {pending === "comment" ? "提交中…" : "提交评论"}
        </button>
      </div>

      {confirming !== null && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              {confirming.label} · {title}
            </h2>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-[var(--console-ink)]">
                原因{confirming.reasonRequired === true ? " *" : ""}
              </span>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink)]"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
              <span className="mt-1 block text-xs text-[var(--console-ink-muted)]">
                该说明会写入受保护的审计记录。
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 text-sm font-semibold text-[var(--console-ink)]"
                disabled={pending !== null}
                onClick={() => {
                  setConfirming(null)
                  setReason("")
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="h-11 rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white disabled:opacity-70"
                disabled={pending !== null}
                onClick={() => {
                  if (confirming.reasonRequired === true && reason.trim().length === 0) {
                    setNotice({ ok: false, text: "退回修改前请填写原因。" })
                    return
                  }
                  void runAction(confirming, reason)
                }}
                type="button"
              >
                {pending !== null ? "处理中…" : "确认操作"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduling && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              创建发布排期 · {title}
            </h2>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-[var(--console-ink)]">发布时间（本地时区）</span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)]"
                onChange={(event) => setScheduledFor(event.target.value)}
                type="datetime-local"
                value={scheduledFor}
              />
              <span className="mt-1 block text-xs text-[var(--console-ink-muted)]">
                将按站点时区 {siteTimezone ?? "UTC"} 快照提交为 UTC 排期。
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 text-sm font-semibold text-[var(--console-ink)]"
                onClick={() => setScheduling(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="h-11 rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white disabled:opacity-70"
                disabled={scheduledFor.length === 0 || pending !== null}
                onClick={() => void submitSchedule()}
                type="button"
              >
                {pending === "schedule" ? "处理中…" : "创建排期"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ArticleWorkflowPanel

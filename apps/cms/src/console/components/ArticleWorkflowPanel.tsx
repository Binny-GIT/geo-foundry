"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  CalendarClockIcon,
  CheckCircleIcon,
  FilePlusIcon,
  MessageSquareIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  isWorkflowStatus,
  type WorkflowAction,
  workflowActionsFor,
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
  const showSchedule = role === "publisher" && ["approved", "compiled"].includes(workflowStatus)
  const hasActions = actions.length > 0 || showQuality || showSchedule
  /*
   * Role gate for the read-only decision list: when the current role cannot
   * act in this status, still surface the full status×role action matrix as
   * disabled buttons (mirrors workflow-actions-model) so operators always see
   * the decision set, e.g. 待审核 → 审核通过 / 审核不通过（审阅）.
   */
  const WORKFLOW_ROLES = ["editor", "reviewer", "publisher"] as const
  const ROLE_BADGES: Readonly<Record<string, string>> = {
    editor: "编辑",
    publisher: "发布",
    reviewer: "审阅",
  }
  const statusActions = isWorkflowStatus(workflowStatus)
    ? WORKFLOW_ROLES.flatMap((workflowRole) =>
        workflowActionsFor(workflowRole, workflowStatus, "zh").map((action) => ({
          action,
          role: workflowRole,
        })),
      )
    : []

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
            <Button
              className="gf-console-focus disabled:cursor-wait"
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
              size="lg"
              type="button"
              variant={action.tone === "primary" ? "default" : "secondary"}
            >
              {action.type === "draft-from-published" ? <FilePlusIcon size={15} /> : null}
              {action.type === "publish-operation" ? <SendIcon size={15} /> : null}
              {action.type === "reviewer-approve" ? <CheckCircleIcon size={15} /> : null}
              {action.target === "generating" ? <SparklesIcon size={15} /> : null}
              {pending === action.label ? "…" : action.label}
            </Button>
          ))}
          {showQuality && (
            <Button
              className="gf-console-focus disabled:cursor-wait"
              disabled={pending !== null}
              onClick={() => void runQuality()}
              size="lg"
              type="button"
              variant="secondary"
            >
              <ShieldCheckIcon size={15} />
              {pending === "quality" ? "…" : "质量检查"}
            </Button>
          )}
          {showSchedule && (
            <Button
              className="gf-console-focus disabled:cursor-wait"
              disabled={pending !== null}
              onClick={() => {
                setScheduling(true)
                setScheduledFor("")
              }}
              size="lg"
              type="button"
              variant="secondary"
            >
              <CalendarClockIcon size={15} />
              创建发布排期
            </Button>
          )}
        </div>
      ) : statusActions.length > 0 ? (
        <div className="grid gap-2 border-t border-[var(--console-border)] pt-4">
          <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
            当前角色在此状态下没有可执行的操作；本状态的流转操作如下。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {statusActions.map(({ action, role: actionRole }) => (
              <Button
                aria-label={`${action.label}（${ROLE_BADGES[actionRole] ?? actionRole}）`}
                className="gf-console-focus"
                disabled
                key={`${actionRole}-${action.type}-${action.label}`}
                size="lg"
                type="button"
                variant={action.tone === "primary" ? "default" : "secondary"}
              >
                {action.label}（{ROLE_BADGES[actionRole] ?? actionRole}）
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="m-0 border-t border-[var(--console-border)] pt-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          {workflowStatus === "archived"
            ? "该稿件已归档，没有后续流转操作。"
            : "当前角色在此状态下没有可执行的操作。"}
        </p>
      )}

      <div className="grid gap-2 border-t border-[var(--console-border)] pt-4">
        <label
          className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]"
          htmlFor="article-comment"
        >
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
        <Button
          className="gf-console-focus"
          disabled={pending !== null || comment.trim().length === 0}
          onClick={() => void submitComment()}
          size="sm"
          type="button"
          variant="secondary"
        >
          <MessageSquareIcon size={15} />
          {pending === "comment" ? "提交中…" : "提交评论"}
        </Button>
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
              <Button
                disabled={pending !== null}
                onClick={() => {
                  setConfirming(null)
                  setReason("")
                }}
                size="lg"
                type="button"
                variant="secondary"
              >
                <XIcon size={15} />
                取消
              </Button>
              <Button
                disabled={pending !== null}
                onClick={() => {
                  if (confirming.reasonRequired === true && reason.trim().length === 0) {
                    setNotice({ ok: false, text: "审核不通过需填写原因。" })
                    return
                  }
                  void runAction(confirming, reason)
                }}
                size="lg"
                type="button"
              >
                <CheckCircleIcon size={15} />
                {pending !== null ? "处理中…" : "确认操作"}
              </Button>
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
              <span className="text-sm font-bold text-[var(--console-ink)]">
                发布时间（本地时区）
              </span>
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
              <Button
                onClick={() => setScheduling(false)}
                size="lg"
                type="button"
                variant="secondary"
              >
                <XIcon size={15} />
                取消
              </Button>
              <Button
                disabled={scheduledFor.length === 0 || pending !== null}
                onClick={() => void submitSchedule()}
                size="lg"
                type="button"
              >
                <CalendarClockIcon size={15} />
                {pending === "schedule" ? "处理中…" : "创建排期"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ArticleWorkflowPanel

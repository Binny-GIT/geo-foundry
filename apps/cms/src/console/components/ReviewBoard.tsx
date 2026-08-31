"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  isWorkflowStatus,
  workflowActionsFor,
  type WorkflowAction,
} from "@/components/workflow/workflow-actions-model"
import { BOARD_COLUMNS, type BoardCard, type BoardColumnKey } from "@/console/lib/board-model"

export type IntakeStripItem = {
  readonly channel: string
  readonly id: number
  readonly title: string
}

type BoardData = Readonly<Record<BoardColumnKey, readonly BoardCard[]>>

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  manual: "手动",
  rss: "RSS",
  url: "URL",
  webhook: "n8n/Webhook",
}

const COLUMN_DOTS: Readonly<Record<string, string>> = {
  approved: "bg-sky-500",
  archived: "bg-slate-600",
  draft: "bg-slate-400",
  published: "bg-emerald-500",
  rejected: "bg-rose-500",
  review: "bg-indigo-500",
}

const ACTION_ERRORS: Readonly<Record<string, string>> = {
  EDITION_WORKFLOW_ASSESSMENT_REQUIRED: "需要先通过一次质量评估。",
  EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED: "质量评估未通过，无法执行此操作。",
  EDITION_WORKFLOW_STALE_ASSESSMENT: "质量评估已过期，请重新运行质量检查。",
  EDITION_WORKFLOW_REASON_REQUIRED: "退回修改前请填写原因。",
  EDITION_WORKFLOW_STALE: "该稿件已在别处变化，请刷新后重试。",
  EDITION_WORKFLOW_REVISION_CONFLICT: "该稿件已在别处变化，请刷新后重试。",
  EDITION_WORKFLOW_NOT_COMPILED: "该稿件尚未编译。",
  EDITION_WORKFLOW_PUBLISHER_REQUIRED: "只有发布者角色可以执行发布操作。",
}

const errorMessageOf = (code: unknown): string =>
  (typeof code === "string" ? ACTION_ERRORS[code] : undefined) ?? "操作未能完成，请刷新后重试。"

const workflowEndpointOf = (action: WorkflowAction, id: number): string =>
  action.type === "draft-from-published"
    ? `/api/editions/${id}/draft-from-published`
    : action.type === "publish-operation"
      ? `/api/editions/${id}/publish-operations`
      : action.type === "reviewer-approve"
        ? `/api/workspaces/reviewer/editions/${id}/approve`
        : action.type === "reviewer-request-changes"
          ? `/api/workspaces/reviewer/editions/${id}/request-changes`
          : `/api/editions/${id}/workflow-transitions`

const formatDate = (value: string | null): string => {
  if (value === null) return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
      }).format(date)
}

const ReviewBoard = ({
  board,
  canCreateEdition,
  canManageIntake,
  canReadInbox,
  intakeItems,
  role,
}: {
  readonly board: BoardData
  readonly canCreateEdition: boolean
  readonly canManageIntake: boolean
  readonly canReadInbox: boolean
  readonly intakeItems: readonly IntakeStripItem[]
  readonly role: string
}) => {
  const router = useRouter()
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [confirming, setConfirming] = useState<{
    readonly action: WorkflowAction
    readonly card: BoardCard
  } | null>(null)
  const [reason, setReason] = useState("")
  const [scheduling, setScheduling] = useState<BoardCard | null>(null)
  const [scheduledFor, setScheduledFor] = useState("")

  const runAction = async (action: WorkflowAction, card: BoardCard, auditReason?: string) => {
    const key = `${card.id}:${action.label}`
    setPendingKey(key)
    setNotice(null)
    try {
      const reviewerDecision =
        action.type === "reviewer-approve" || action.type === "reviewer-request-changes"
      const normalizedReason = auditReason?.trim()
      const response = await fetch(workflowEndpointOf(action, card.id), {
        body: JSON.stringify({
          ...(action.type === "transition" ? { target: action.target } : {}),
          ...(reviewerDecision ? { expectedRevision: card.workflowRevision } : {}),
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
      if (!response.ok) throw new Error(errorMessageOf(result.error?.code))
      setConfirming(null)
      setReason("")
      setNotice({ ok: true, text: `${card.title}：${action.label}已完成` })
      router.refresh()
    } catch (error) {
      setNotice({
        ok: false,
        text: `${card.title}：${error instanceof Error ? error.message : errorMessageOf(undefined)}`,
      })
    } finally {
      setPendingKey(null)
    }
  }

  const runQuality = async (card: BoardCard) => {
    const key = `${card.id}:quality`
    setPendingKey(key)
    setNotice(null)
    try {
      const response = await fetch(`/api/workspaces/editor/editions/${card.id}/evaluation-operations`, {
        body: JSON.stringify({}),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        method: "POST",
      })
      if (!response.ok) throw new Error(errorMessageOf(undefined))
      setNotice({ ok: true, text: `${card.title}：已提交质量检查` })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "提交质量检查失败。" })
    } finally {
      setPendingKey(null)
    }
  }

  const intakeAction = async (item: IntakeStripItem, action: "adopt" | "ignore") => {
    const key = `intake-${item.id}`
    setPendingKey(key)
    setNotice(null)
    try {
      const response = await fetch(`/api/intake-operations/${item.id}/${action}`, {
        credentials: "same-origin",
        method: "POST",
      })
      if (!response.ok) throw new Error(action === "adopt" ? "采用失败。" : "忽略失败。")
      setNotice({
        ok: true,
        text: action === "adopt" ? `${item.title}：已采用为草稿` : `${item.title}：已忽略`,
      })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "操作失败。" })
    } finally {
      setPendingKey(null)
    }
  }

  const submitSchedule = async () => {
    if (scheduling === null || scheduledFor.length === 0) return
    const card = scheduling
    setPendingKey(`${card.id}:schedule`)
    setNotice(null)
    try {
      const response = await fetch("/api/publication-plan-operations", {
        body: JSON.stringify({
          editionId: card.id,
          scheduledFor: new Date(scheduledFor).toISOString(),
          timezone: card.siteTimezone ?? "UTC",
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error("创建发布排期失败。")
      setScheduling(null)
      setScheduledFor("")
      setNotice({ ok: true, text: `${card.title}：已创建发布排期` })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "创建发布排期失败。" })
    } finally {
      setPendingKey(null)
    }
  }

  const cardActions = (card: BoardCard): readonly WorkflowAction[] =>
    isWorkflowStatus(card.workflowStatus)
      ? workflowActionsFor(role, card.workflowStatus, "zh")
      : []

  return (
    <div className="grid gap-5">
      {canReadInbox && (
        <section className="gf-console-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className="gf-console-focus flex items-center gap-2 rounded-xl bg-[var(--console-surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--console-ink)]"
              onClick={() => setIntakeOpen((open) => !open)}
              type="button"
            >
              新稿源
              <span className="grid min-w-6 place-items-center rounded-full bg-indigo-600 px-1.5 text-xs font-bold text-white">
                {intakeItems.length}
              </span>
              <span className="text-xs text-[var(--console-ink-muted)]">
                {intakeOpen ? "收起" : "展开"}
              </span>
            </button>
            <div className="flex flex-wrap gap-2">
              <Link
                className="gf-console-focus inline-flex h-9 items-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-xs font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
                href="/admin/inbox"
              >
                导入 URL / 全部稿源
              </Link>
              {canCreateEdition && (
                <Link
                  className="gf-console-focus inline-flex h-9 items-center rounded-xl bg-[var(--console-accent)] px-3 text-xs font-semibold text-white no-underline hover:bg-[var(--console-accent-hover)]"
                  href="/admin/workspace/editions/new"
                >
                  新建文章
                </Link>
              )}
            </div>
          </div>
          {intakeOpen && (
            <>
              {intakeItems.length === 0 ? (
                <p className="m-0 mt-4 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-sm text-[var(--console-ink-muted)]">
                  没有待处理的新稿源；采集与 n8n/Webhook 进入的内容会出现在这里。
                </p>
              ) : (
                <ul className="m-0 mt-4 grid max-h-[340px] list-none gap-2 overflow-y-auto p-0 pr-1">
                  {intakeItems.map((item) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 py-3"
                      key={item.id}
                    >
                      <span className="min-w-0 flex-1 text-sm font-medium text-[var(--console-ink)]">
                        <span className="line-clamp-2 break-words">{item.title}</span>
                        <span className="ml-2 inline-block shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 align-middle text-[11px] font-bold text-indigo-700">
                          {CHANNEL_LABELS[item.channel] ?? item.channel}
                        </span>
                      </span>
                      {canManageIntake && (
                        <span className="flex shrink-0 gap-2">
                          <button
                            className="gf-console-focus h-8 rounded-lg bg-[var(--console-accent)] px-3 text-xs font-semibold text-white disabled:opacity-60"
                            disabled={pendingKey !== null}
                            onClick={() => void intakeAction(item, "adopt")}
                            type="button"
                          >
                            采用为草稿
                          </button>
                          <button
                            className="gf-console-focus h-8 rounded-lg border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-xs font-semibold text-[var(--console-ink)] disabled:opacity-60"
                            disabled={pendingKey !== null}
                            onClick={() => void intakeAction(item, "ignore")}
                            type="button"
                          >
                            忽略
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {intakeItems.length > 0 && (
                <p className="m-0 mt-2 text-center text-xs text-[var(--console-ink-muted)]">
                  共 {intakeItems.length} 条，可在
                  <a className="font-semibold text-indigo-700 no-underline hover:underline" href="/admin/inbox">
                    稿源箱
                  </a>
                  查看全部与重试失败抓取
                </p>
              )}
            </>
          )}
        </section>
      )}

      {notice !== null && (
        <p
          className={`m-0 rounded-xl border px-4 py-3 text-sm ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <section className="overflow-x-auto pb-2">
        <div className="grid min-w-[1500px] grid-cols-6 gap-4">
          {BOARD_COLUMNS.map((column) => {
            const cards = board[column.key]
            return (
              <div className="grid content-start gap-3" key={column.key}>
                <header className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl bg-[var(--console-surface-muted)] px-3 py-2">
                  <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-[var(--console-ink)]">
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${COLUMN_DOTS[column.key] ?? "bg-slate-400"}`} />
                    {column.label}
                  </h2>
                  <span className="grid min-w-6 place-items-center rounded-full bg-[var(--console-surface)] px-1.5 text-xs font-bold tabular-nums text-[var(--console-ink-muted)]">
                    {cards.length}
                  </span>
                </header>
                {cards.length === 0 ? (
                  <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-3 text-center text-xs text-[var(--console-ink-muted)]">
                    暂无稿件
                  </p>
                ) : (
                  cards.map((card) => (
                    <article
                      className="gf-console-card grid gap-2.5 p-3.5"
                      key={card.id}
                    >
                      <Link
                        className="gf-console-focus truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-indigo-600"
                        href={`/admin/workspace/editions/${card.id}`}
                      >
                        {card.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--console-ink-muted)]">
                        <span className="truncate">{card.siteName ?? "受限站点"}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{card.ownerEmail ?? "未分配"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(card.updatedAt)}</span>
                        {card.workflowStatus === "generating" && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                            生成中
                          </span>
                        )}
                      </div>
                      {card.rejectedReason !== null && (
                        <p className="m-0 line-clamp-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] leading-4 text-rose-700">
                          退回：{card.rejectedReason}
                        </p>
                      )}
                      {cardActions(card).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 border-t border-[var(--console-border)] pt-2">
                          {cardActions(card).map((action) => (
                            <button
                              className={`gf-console-focus h-7 rounded-lg px-2.5 text-[11px] font-semibold disabled:cursor-wait disabled:opacity-60 ${
                                action.tone === "primary"
                                  ? "bg-[var(--console-accent)] text-white"
                                  : "border border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink)]"
                              }`}
                              disabled={pendingKey !== null}
                              key={action.label}
                              onClick={() => {
                                if (action.confirm === true || action.reasonRequired === true) {
                                  setConfirming({ action, card })
                                  setReason("")
                                  return
                                }
                                void runAction(action, card)
                              }}
                              type="button"
                            >
                              {pendingKey === `${card.id}:${action.label}` ? "…" : action.label}
                            </button>
                          ))}
                          {role === "editor" &&
                            (card.workflowStatus === "draft" ||
                              card.workflowStatus === "generating" ||
                              card.workflowStatus === "review") && (
                              <button
                                className="gf-console-focus h-7 rounded-lg border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-[11px] font-semibold text-[var(--console-ink)] disabled:cursor-wait disabled:opacity-60"
                                disabled={pendingKey !== null}
                                onClick={() => void runQuality(card)}
                                type="button"
                              >
                                {pendingKey === `${card.id}:quality` ? "…" : "质量检查"}
                              </button>
                            )}
                          {role === "publisher" &&
                            (card.workflowStatus === "approved" ||
                              card.workflowStatus === "compiled") && (
                              <button
                                className="gf-console-focus h-7 rounded-lg border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-[11px] font-semibold text-[var(--console-ink)] disabled:cursor-wait disabled:opacity-60"
                                disabled={pendingKey !== null}
                                onClick={() => {
                                  setScheduling(card)
                                  setScheduledFor("")
                                }}
                                type="button"
                              >
                                排期
                              </button>
                            )}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            )
          })}
        </div>
      </section>

      {confirming !== null && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              {confirming.action.label} · {confirming.card.title}
            </h2>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-[var(--console-ink)]">
                原因{confirming.action.reasonRequired === true ? " *" : ""}
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
                disabled={pendingKey !== null}
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
                disabled={pendingKey !== null}
                onClick={() => {
                  if (confirming.action.reasonRequired === true && reason.trim().length === 0) {
                    setNotice({ ok: false, text: "退回修改前请填写原因。" })
                    return
                  }
                  void runAction(confirming.action, confirming.card, reason)
                }}
                type="button"
              >
                {pendingKey !== null ? "处理中…" : "确认操作"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduling !== null && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              创建发布排期 · {scheduling.title}
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
                将按站点时区 {scheduling.siteTimezone ?? "UTC"} 快照提交为 UTC 排期。
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 text-sm font-semibold text-[var(--console-ink)]"
                onClick={() => setScheduling(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="h-11 rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white disabled:opacity-70"
                disabled={scheduledFor.length === 0 || pendingKey !== null}
                onClick={() => void submitSchedule()}
                type="button"
              >
                {pendingKey === `${scheduling.id}:schedule` ? "处理中…" : "创建排期"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ReviewBoard

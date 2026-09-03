"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ShieldCheckIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  isWorkflowStatus,
  type WorkflowAction,
  workflowActionsFor,
} from "@/components/workflow/workflow-actions-model"
import { canDragCard, dropActionFor, dropHintFor, ownColumnOf } from "@/console/lib/board-dnd"
import { BOARD_COLUMNS, type BoardCard, type BoardColumnKey } from "@/console/lib/board-model"
import {
  editionActionErrorMessage,
  editionEvaluationEndpointOf,
  editionWorkflowEndpointOf,
  publicationPlanEndpoint,
} from "@/console/lib/edition-workflow-client"
import { consoleRoute } from "@/console/lib/resources"
import { cn } from "@/lib/utils"

type BoardData = Readonly<Record<BoardColumnKey, readonly BoardCard[]>>

const COLUMN_DOTS: Readonly<Record<string, string>> = {
  approved: "bg-sky-500",
  archived: "bg-slate-600",
  draft: "bg-slate-400",
  published: "bg-emerald-500",
  rejected: "bg-rose-500",
  review: "bg-indigo-500",
}

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
  role,
  showColumns,
}: {
  readonly board: BoardData
  readonly role: string
  readonly showColumns: readonly BoardColumnKey[]
}) => {
  const router = useRouter()
  const columns = BOARD_COLUMNS.filter((column) => showColumns.includes(column.key))
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [confirming, setConfirming] = useState<{
    readonly action: WorkflowAction
    readonly card: BoardCard
  } | null>(null)
  const [reason, setReason] = useState("")
  const [scheduling, setScheduling] = useState<BoardCard | null>(null)
  const [scheduledFor, setScheduledFor] = useState("")
  const [dragCard, setDragCard] = useState<BoardCard | null>(null)
  const [dropColumn, setDropColumn] = useState<BoardColumnKey | null>(null)

  /*
   * Drag-and-drop status change: resolve the drop target column to the
   * legal workflow action for this card/role. Confirmation-required or
   * reason-required moves open the existing dialog instead of firing
   * immediately; illegal drops surface a notice instead of a silent no-op.
   */
  const handleDrop = (targetColumn: BoardColumnKey) => {
    const card = dragCard
    setDropColumn(null)
    setDragCard(null)
    if (card === null) return
    /*
     * Dropping back onto the card's own lane is a reorder, not a workflow
     * request — no fetch, no notice.
     */
    if (ownColumnOf(card) === targetColumn) return
    const action = dropActionFor(role, card.workflowStatus, targetColumn)
    if (action === null) {
      setNotice({ ok: false, text: `${card.title}：${dropHintFor(card, targetColumn)}` })
      return
    }
    if (action.type === "publish-schedule") {
      // approved → 已发布：先排期，编译与上线由发布链路完成。
      setNotice(null)
      setScheduling(card)
      setScheduledFor("")
      return
    }
    if (action.confirm === true || action.reasonRequired === true) {
      setConfirming({ action, card })
      setReason("")
      return
    }
    void runAction(action, card)
  }

  const runAction = async (action: WorkflowAction, card: BoardCard, auditReason?: string) => {
    const key = `${card.id}:${action.label}`
    setPendingKey(key)
    setNotice(null)
    try {
      const reviewerDecision =
        action.type === "reviewer-approve" || action.type === "reviewer-request-changes"
      const normalizedReason = auditReason?.trim()
      const response = await fetch(editionWorkflowEndpointOf(action, card.id), {
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
      if (!response.ok) throw new Error(editionActionErrorMessage(result.error?.code))
      setConfirming(null)
      setReason("")
      setNotice({ ok: true, text: `${card.title}：${action.label}已完成` })
      router.refresh()
    } catch (error) {
      setNotice({
        ok: false,
        text: `${card.title}：${error instanceof Error ? error.message : editionActionErrorMessage(undefined)}`,
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
      const response = await fetch(editionEvaluationEndpointOf(card.id), {
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
      setNotice({ ok: true, text: `${card.title}：已提交质量检查` })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "提交质量检查失败。" })
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
      const response = await fetch(publicationPlanEndpoint, {
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
    isWorkflowStatus(card.workflowStatus) ? workflowActionsFor(role, card.workflowStatus, "zh") : []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {notice !== null && (
        <p
          className={`m-0 rounded-md border px-4 py-3 text-sm ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <section className="min-h-0 flex-1 overflow-auto pb-2 pr-1">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(6,minmax(180px,1fr))]">
          {columns.map((column) => {
            const cards = board[column.key]
            return (
              <div
                className={cn(
                  "grid min-w-0 content-start gap-3 rounded-xl transition-shadow",
                  dropColumn === column.key && dragCard !== null
                    ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-[var(--console-canvas)]"
                    : "",
                )}
                key={column.key}
                onDragLeave={() =>
                  setDropColumn((current) => (current === column.key ? null : current))
                }
                onDragOver={(event) => {
                  if (dragCard === null) return
                  event.preventDefault()
                  setDropColumn(column.key)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  handleDrop(column.key)
                }}
              >
                <header className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-[var(--console-surface-muted)] px-3 py-2">
                  <h2 className="m-0 flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--console-ink)]">
                    <span
                      aria-hidden="true"
                      className={`size-2 shrink-0 rounded-full ${COLUMN_DOTS[column.key] ?? "bg-slate-400"}`}
                    />
                    <span className="truncate">{column.label}</span>
                  </h2>
                  <span className="grid min-w-6 place-items-center rounded-full bg-[var(--console-surface)] px-1.5 text-xs font-bold tabular-nums text-[var(--console-ink-muted)]">
                    {cards.length}
                  </span>
                </header>
                {cards.length === 0 ? (
                  <p className="m-0 rounded-md border border-dashed border-[var(--console-border)] p-3 text-center text-xs text-[var(--console-ink-muted)]">
                    暂无稿件
                  </p>
                ) : (
                  cards.map((card) => (
                    <article
                      className={cn(
                        "gf-console-card grid min-w-0 gap-2.5 p-3.5",
                        canDragCard(role, card.workflowStatus) &&
                          "cursor-grab active:cursor-grabbing",
                        dragCard?.id === card.id && "opacity-50",
                      )}
                      draggable={canDragCard(role, card.workflowStatus)}
                      key={card.id}
                      onDragEnd={() => {
                        setDragCard(null)
                        setDropColumn(null)
                      }}
                      onDragStart={(event) => {
                        setDragCard(card)
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", String(card.id))
                      }}
                    >
                      <Link
                        className="gf-console-focus truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                        draggable={false}
                        href={consoleRoute.document("content-editions", String(card.id))}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {card.title}
                      </Link>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--console-ink-muted)]">
                        <span className="min-w-0 max-w-full truncate">
                          {card.siteName ?? "受限站点"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="min-w-0 max-w-full truncate">
                          {card.ownerEmail ?? "未分配"}
                        </span>
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
                        <div className="flex min-w-0 flex-wrap gap-1.5 border-t border-[var(--console-border)] pt-2">
                          {cardActions(card).map((action) => (
                            <Button
                              className="h-7 px-2.5 text-[11px]"
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
                              variant={action.tone === "primary" ? "default" : "secondary"}
                            >
                              {pendingKey === `${card.id}:${action.label}` ? "…" : action.label}
                            </Button>
                          ))}
                          {(role === "editor" || role === "super-admin") &&
                            (card.workflowStatus === "draft" ||
                              card.workflowStatus === "generating" ||
                              card.workflowStatus === "review") && (
                              <Button
                                className="h-7 px-2.5 text-[11px]"
                                disabled={pendingKey !== null}
                                onClick={() => void runQuality(card)}
                                type="button"
                                variant="secondary"
                              >
                                <ShieldCheckIcon size={15} />
                                {pendingKey === `${card.id}:quality` ? "…" : "质量检查"}
                              </Button>
                            )}
                          {(role === "publisher" || role === "super-admin") &&
                            (card.workflowStatus === "approved" ||
                              card.workflowStatus === "compiled") && (
                              <Button
                                className="h-7 px-2.5 text-[11px]"
                                disabled={pendingKey !== null}
                                onClick={() => {
                                  setScheduling(card)
                                  setScheduledFor("")
                                }}
                                type="button"
                                variant="secondary"
                              >
                                排期
                              </Button>
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
                className="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink)]"
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
                disabled={pendingKey !== null}
                onClick={() => {
                  setConfirming(null)
                  setReason("")
                }}
                size="lg"
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button
                disabled={pendingKey !== null}
                onClick={() => {
                  if (confirming.action.reasonRequired === true && reason.trim().length === 0) {
                    setNotice({ ok: false, text: "审核不通过需填写原因。" })
                    return
                  }
                  void runAction(confirming.action, confirming.card, reason)
                }}
                size="lg"
                type="button"
              >
                {pendingKey !== null ? "处理中…" : "确认操作"}
              </Button>
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
              <span className="text-sm font-bold text-[var(--console-ink)]">
                发布时间（本地时区）
              </span>
              <input
                className="mt-2 h-11 w-full rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)]"
                onChange={(event) => setScheduledFor(event.target.value)}
                type="datetime-local"
                value={scheduledFor}
              />
              <span className="mt-1 block text-xs text-[var(--console-ink-muted)]">
                将按站点时区 {scheduling.siteTimezone ?? "UTC"} 快照提交为 UTC 排期。
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setScheduling(null)}
                size="lg"
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button
                disabled={scheduledFor.length === 0 || pendingKey !== null}
                onClick={() => void submitSchedule()}
                size="lg"
                type="button"
              >
                {pendingKey === `${scheduling.id}:schedule` ? "处理中…" : "创建排期"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ReviewBoard

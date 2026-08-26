"use client"

import { toast, useAuth, useDocumentInfo, useFormFields, useTranslation } from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import type { UIFieldClientProps } from "payload"
import { useEffect, useId, useRef, useState } from "react"

import { uiLangOf } from "../i18n/ui-lang"
import { Badge } from "../ui/Badge"
import {
  isWorkflowStatus,
  workflowActionsFor,
  workflowStatusLabel,
  WORKFLOW_TONE,
  type WorkflowAction,
} from "./workflow-actions-model"

const MESSAGE = {
  en: {
    approveImpact: "Approval confirms that the visible quality evidence is accepted. Compilation remains a separate controlled step.",
    archiveImpact: "Archived editions leave the release ledger intact and no longer appear as active editorial work.",
    assessment: "A passed quality assessment is required before this action.",
    cancel: "Cancel",
    confirm: "Confirm action",
    createDraftImpact: "A new editable draft is created from this published edition. The published release and its artifacts remain unchanged.",
    default: "This workflow action did not complete.",
    draftCreated: "New draft created.",
    notCompiled: "This edition has not been compiled.",
    publisherRequired: "Only the publisher role may request publishing.",
    publishImpact: "This creates a background publish operation. It is not live until the operation succeeds, the release becomes current, and a verified receipt is recorded.",
    publishSubmitted: "Publish request submitted; it will complete in the background.",
    reason: "Reason",
    reasonHint: "This explanation is included in the protected audit trail.",
    reasonRequired: "Add a reason before requesting changes.",
    requestChangesImpact: "The edition returns to Draft so the editor can revise it. Your reason is required and becomes part of the audit trail.",
    stale: "This edition changed elsewhere — refresh and retry.",
    transitioned: (status: string) => `Edition moved to ${status}.`,
    workflow: "Workflow",
    workflowActions: "Edition workflow actions",
    currentState: "Current state",
    working: "Working…",
  },
  zh: {
    approveImpact: "批准表示接受当前可见的质量证据；编译仍是独立的受控步骤。",
    archiveImpact: "归档不会修改发布台账；该版本将不再作为活跃编辑工作显示。",
    assessment: "需要先获得一次通过的质量评估，才能进行此操作。",
    cancel: "取消",
    confirm: "确认操作",
    createDraftImpact: "将基于此已发布版本创建新的可编辑草稿；已发布版本及其制品保持不变。",
    default: "该工作流操作未能完成。",
    draftCreated: "已创建新草稿。",
    notCompiled: "该版本尚未编译。",
    publisherRequired: "只有发布者角色可以请求发布。",
    publishImpact: "此操作只会创建后台发布任务。仅当操作成功、发布版本成为当前版本且已记录验证回执后，才算真正上线。",
    publishSubmitted: "已提交发布请求，将在后台完成。",
    reason: "原因",
    reasonHint: "该说明会写入受保护的审计记录。",
    reasonRequired: "退回修改前请填写原因。",
    requestChangesImpact: "版本将退回草稿，供编辑修改。必须填写原因，并将其写入审计记录。",
    stale: "该版本已在别处发生变化，请刷新后重试。",
    transitioned: (status: string) => `版本已流转至 ${status}。`,
    workflow: "工作流",
    workflowActions: "内容版本工作流操作",
    currentState: "当前状态",
    working: "处理中…",
  },
}

const requiresConfirmation = (action: WorkflowAction): boolean => action.confirm === true

const requiresReason = (action: WorkflowAction): boolean => action.reasonRequired === true

const impactFor = (action: WorkflowAction, messages: (typeof MESSAGE)["zh"]): string | null => {
  if (action.type === "draft-from-published") return messages.createDraftImpact
  if (action.type === "publish-operation") return messages.publishImpact
  if (action.target === "approved") return messages.approveImpact
  if (action.target === "archived") return messages.archiveImpact
  if (requiresReason(action)) return messages.requestChangesImpact
  return null
}

/**
 * Workflow status remains service-owned. This UI only invokes the existing
 * session-authenticated endpoints, whose domain guards enforce actor role,
 * tenant scope, quality gates, and optimistic revision checks.
 */
export const WorkflowActions = (_: UIFieldClientProps) => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const router = useRouter()
  const statusValue = useFormFields(([fields]) => fields["workflowStatus"]?.value)
  const [pending, setPending] = useState<string | null>(null)
  const [selectedAction, setSelectedAction] = useState<WorkflowAction | null>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const reasonId = useId()
  const lang = uiLangOf(i18n.language)
  const M = MESSAGE[lang]

  useEffect(() => {
    if (selectedAction !== null) confirmButton.current?.focus()
  }, [selectedAction])

  if (id === undefined || id === null || !isWorkflowStatus(statusValue)) return null

  const actions = workflowActionsFor(user?.["role"], statusValue, i18n.language)
  if (actions.length === 0) return null

  const messageFor = (code: unknown): string => {
    switch (code) {
      case "EDITION_WORKFLOW_ASSESSMENT_REQUIRED":
      case "EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED":
      case "EDITION_WORKFLOW_STALE_ASSESSMENT":
        return M.assessment
      case "EDITION_WORKFLOW_REASON_REQUIRED":
        return M.reasonRequired
      case "EDITION_WORKFLOW_STALE":
      case "EDITION_WORKFLOW_REVISION_CONFLICT":
        return M.stale
      case "EDITION_WORKFLOW_NOT_COMPILED":
        return M.notCompiled
      case "EDITION_WORKFLOW_PUBLISHER_REQUIRED":
        return M.publisherRequired
      default:
        return M.default
    }
  }

  const closeConfirmation = () => {
    if (pending === null) {
      setSelectedAction(null)
      setReason("")
      setReasonError(null)
    }
  }

  const run = async (action: WorkflowAction, auditReason?: string) => {
    setPending(action.label)
    try {
      const endpoint =
        action.type === "draft-from-published"
          ? `/api/editions/${id}/draft-from-published`
          : action.type === "publish-operation"
            ? `/api/editions/${id}/publish-operations`
            : `/api/editions/${id}/workflow-transitions`
      const normalizedReason = auditReason?.trim()
      const body = {
        ...(action.type === "transition" ? { target: action.target } : {}),
        ...(normalizedReason === undefined || normalizedReason.length === 0 ? {} : { reason: normalizedReason }),
      }
      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: { code?: unknown }
        workflowStatus?: unknown
      }
      if (!response.ok) throw new Error(messageFor(result.error?.code))
      toast.success(
        action.type === "draft-from-published"
          ? M.draftCreated
          : action.type === "publish-operation"
            ? M.publishSubmitted
            : M.transitioned(
                isWorkflowStatus(result.workflowStatus)
                  ? workflowStatusLabel(result.workflowStatus, i18n.language)
                  : workflowStatusLabel(action.target ?? statusValue, i18n.language),
              ),
      )
      setSelectedAction(null)
      setReason("")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : M.default)
    } finally {
      setPending(null)
    }
  }

  const confirm = () => {
    if (selectedAction === null) return
    if (requiresReason(selectedAction) && reason.trim().length === 0) {
      setReasonError(M.reasonRequired)
      return
    }
    void run(selectedAction, reason)
  }

  return (
    <>
      <section
        aria-label={M.workflowActions}
        className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]"
      >
        <div>
          <p className="m-0 mb-1.5 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            {M.workflow}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--theme-elevation-600)]">{M.currentState}</span>
            <Badge tone={WORKFLOW_TONE[statusValue]}>{workflowStatusLabel(statusValue, i18n.language)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {actions.map((action) => (
            <button
              className={`min-h-11 rounded-lg px-4 text-sm font-bold transition-opacity ${
                action.tone === "primary"
                  ? "bg-[var(--gf-accent-600)] text-white hover:bg-[var(--gf-accent-700)]"
                  : "border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-100)] text-[var(--theme-text)] hover:bg-[var(--theme-elevation-150)]"
              } ${pending !== null ? "cursor-wait opacity-70" : "cursor-pointer"}`}
              disabled={pending !== null}
              key={action.label}
              onClick={() => {
                if (requiresConfirmation(action)) {
                  setSelectedAction(action)
                  setReason("")
                  setReasonError(null)
                  return
                }
                void run(action)
              }}
              type="button"
            >
              {pending === action.label ? M.working : action.label}
            </button>
          ))}
        </div>
      </section>

      {selectedAction !== null && (
        <div
          aria-labelledby={`${reasonId}-title`}
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeConfirmation()
          }}
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-6 shadow-2xl">
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {M.workflow}
            </p>
            <h2 className="m-0 mt-1 text-xl font-bold tracking-tight text-[var(--theme-text)]" id={`${reasonId}-title`}>
              {selectedAction.label}
            </h2>
            <p className="m-0 mt-3 text-sm leading-6 text-[var(--theme-elevation-700)]">
              {impactFor(selectedAction, M)}
            </p>

            {(requiresReason(selectedAction) || selectedAction.type === "publish-operation") && (
              <label className="mt-5 block" htmlFor={reasonId}>
                <span className="block text-sm font-bold text-[var(--theme-text)]">
                  {M.reason}{requiresReason(selectedAction) ? " *" : ""}
                </span>
                <span className="mt-1 block text-xs text-[var(--theme-elevation-600)]">{M.reasonHint}</span>
                <textarea
                  aria-describedby={reasonError === null ? undefined : `${reasonId}-error`}
                  aria-invalid={reasonError !== null}
                  className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm text-[var(--theme-text)] outline-none transition focus:border-[var(--gf-accent-500)] focus:ring-2 focus:ring-[var(--gf-accent-200)]"
                  id={reasonId}
                  maxLength={500}
                  onChange={(event) => {
                    setReason(event.target.value)
                    if (reasonError !== null) setReasonError(null)
                  }}
                  required={requiresReason(selectedAction)}
                  value={reason}
                />
                {reasonError !== null && (
                  <span className="mt-1 block text-xs font-semibold text-[var(--theme-error-700)]" id={`${reasonId}-error`}>
                    {reasonError}
                  </span>
                )}
              </label>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="min-h-11 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-100)] px-4 text-sm font-bold text-[var(--theme-text)] hover:bg-[var(--theme-elevation-150)]"
                disabled={pending !== null}
                onClick={closeConfirmation}
                type="button"
              >
                {M.cancel}
              </button>
              <button
                className="min-h-11 rounded-lg bg-[var(--gf-accent-600)] px-4 text-sm font-bold text-white hover:bg-[var(--gf-accent-700)] disabled:cursor-wait disabled:opacity-70"
                disabled={pending !== null}
                onClick={confirm}
                ref={confirmButton}
                type="button"
              >
                {pending === selectedAction.label ? M.working : M.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

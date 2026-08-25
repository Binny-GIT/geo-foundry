"use client"

import { toast, useAuth, useDocumentInfo, useFormFields, useTranslation } from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import type { UIFieldClientProps } from "payload"
import { useState } from "react"

import { uiLangOf } from "../i18n/ui-lang"
import { Badge } from "../ui/Badge"
import {
  isWorkflowStatus,
  workflowActionsFor,
  WORKFLOW_TONE,
  type WorkflowAction,
} from "./workflow-actions-model"

const MESSAGE = {
  en: {
    assessment: "A passed quality assessment is required before this action.",
    default: "This workflow action did not complete.",
    notCompiled: "This edition has not been compiled.",
    publisherRequired: "Only the publisher role may request publishing.",
    stale: "This edition changed elsewhere — refresh and retry.",
    draftCreated: "New draft created.",
    publishSubmitted: "Publish request submitted; it will complete in the background.",
    transitioned: (status: string) => `Edition moved to ${status}.`,
  },
  zh: {
    assessment: "需要先获得一次通过的质量评估，才能进行此操作。",
    default: "该工作流操作未能完成。",
    notCompiled: "该版本尚未编译。",
    publisherRequired: "只有发布者角色可以请求发布。",
    stale: "该版本已在别处发生变化，请刷新后重试。",
    draftCreated: "已创建新草稿。",
    publishSubmitted: "已提交发布请求，将在后台完成。",
    transitioned: (status: string) => `版本已流转至 ${status}。`,
  },
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
  const lang = uiLangOf(i18n.language)
  const M = MESSAGE[lang]

  if (id === undefined || id === null || !isWorkflowStatus(statusValue)) return null

  const actions = workflowActionsFor(user?.["role"], statusValue, i18n.language)
  if (actions.length === 0) return null

  const messageFor = (code: unknown): string => {
    switch (code) {
      case "EDITION_WORKFLOW_ASSESSMENT_REQUIRED":
      case "EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED":
        return M.assessment
      case "EDITION_WORKFLOW_STALE":
        return M.stale
      case "EDITION_WORKFLOW_NOT_COMPILED":
        return M.notCompiled
      case "EDITION_WORKFLOW_PUBLISHER_REQUIRED":
        return M.publisherRequired
      default:
        return M.default
    }
  }

  const run = async (action: WorkflowAction) => {
    setPending(action.label)
    try {
      const endpoint =
        action.type === "draft-from-published"
          ? `/api/editions/${id}/draft-from-published`
          : action.type === "publish-operation"
            ? `/api/editions/${id}/publish-operations`
            : `/api/editions/${id}/workflow-transitions`
      const body = action.type === "transition" ? { target: action.target } : {}
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
            : M.transitioned(String(result.workflowStatus ?? action.target)),
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : M.default)
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      aria-label="Edition workflow actions"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]"
    >
      <div>
        <p className="m-0 mb-1.5 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
          {lang === "en" ? "Workflow" : "工作流"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--theme-elevation-600)]">
            {lang === "en" ? "Current state" : "当前状态"}
          </span>
          <Badge tone={WORKFLOW_TONE[statusValue]}>{statusValue}</Badge>
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
            onClick={() => void run(action)}
            type="button"
          >
            {pending === action.label ? (lang === "en" ? "Working…" : "处理中…") : action.label}
          </button>
        ))}
      </div>
    </section>
  )
}

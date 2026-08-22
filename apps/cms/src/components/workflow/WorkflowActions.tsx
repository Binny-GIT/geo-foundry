"use client"

import { toast, useAuth, useDocumentInfo, useFormFields } from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import type { UIFieldClientProps } from "payload"
import { useState } from "react"

type WorkflowStatus =
  | "draft"
  | "generating"
  | "review"
  | "approved"
  | "compiled"
  | "published"
  | "archived"

type WorkflowAction = {
  readonly label: string
  readonly tone: "primary" | "secondary"
  readonly target?: WorkflowStatus
  readonly type: "draft-from-published" | "transition"
}

const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "draft" ||
  value === "generating" ||
  value === "review" ||
  value === "approved" ||
  value === "compiled" ||
  value === "published" ||
  value === "archived"

const actionFor = (role: unknown, state: WorkflowStatus): WorkflowAction[] => {
  if (role === "reviewer" && state === "review") {
    return [
      { label: "Approve edition", target: "approved", tone: "primary", type: "transition" },
      { label: "Request revision", target: "draft", tone: "secondary", type: "transition" },
    ]
  }
  if (role === "publisher" && state === "compiled") {
    return [{ label: "Publish edition", target: "published", tone: "primary", type: "transition" }]
  }
  if (role === "publisher" && state === "published") {
    return [{ label: "Archive edition", target: "archived", tone: "secondary", type: "transition" }]
  }
  if (role === "editor" && state === "published") {
    return [{ label: "Create next draft", tone: "primary", type: "draft-from-published" }]
  }
  return []
}

const messageFor = (code: unknown): string => {
  switch (code) {
    case "EDITION_WORKFLOW_ASSESSMENT_REQUIRED":
    case "EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED":
      return "A passed quality assessment is required before this transition."
    case "EDITION_WORKFLOW_STALE":
      return "This edition changed elsewhere. Refresh and try again."
    default:
      return "The workflow action could not be completed."
  }
}

const WORKFLOW_BADGE: Record<WorkflowStatus, { bg: string; fg: string }> = {
  approved: { bg: "#f3e8ff", fg: "#7c3aed" },
  archived: { bg: "#e2e8f0", fg: "#475569" },
  compiled: { bg: "#cffafe", fg: "#0e7490" },
  draft: { bg: "#e2e8f0", fg: "#475569" },
  generating: { bg: "#dbeafe", fg: "#1d4ed8" },
  published: { bg: "#dcfce7", fg: "#15803d" },
  review: { bg: "#fef3c7", fg: "#b45309" },
}

const buttonStyle = (tone: WorkflowAction["tone"], pending: boolean) => ({
  background:
    tone === "primary"
      ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
      : "var(--theme-elevation-100)",
  border: tone === "primary" ? "1px solid #1d4ed8" : "1px solid var(--theme-elevation-250)",
  borderRadius: "0.45rem",
  boxShadow: tone === "primary" ? "0 4px 12px rgb(37 99 235 / 30%)" : "none",
  color: tone === "primary" ? "white" : "var(--theme-text)",
  cursor: pending ? "wait" : "pointer",
  fontSize: "0.85rem",
  fontWeight: 700,
  opacity: pending ? 0.7 : 1,
  padding: "0.6rem 1rem",
})

/**
 * Workflow status remains service-owned. This UI only invokes the existing
 * session-authenticated endpoints, whose domain guards enforce actor role,
 * tenant scope, quality gates, and optimistic revision checks.
 */
export const WorkflowActions = (_: UIFieldClientProps) => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const router = useRouter()
  const statusValue = useFormFields(([fields]) => fields["workflowStatus"]?.value)
  const [pending, setPending] = useState<string | null>(null)

  if (id === undefined || id === null || !isWorkflowStatus(statusValue)) {
    return null
  }

  const actions = actionFor(user?.["role"], statusValue)
  if (actions.length === 0) {
    return null
  }

  const run = async (action: WorkflowAction) => {
    setPending(action.label)
    try {
      const endpoint =
        action.type === "draft-from-published"
          ? `/api/editions/${id}/draft-from-published`
          : `/api/editions/${id}/workflow-transitions`
      const body = action.type === "draft-from-published" ? {} : { target: action.target }
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
      if (!response.ok) {
        throw new Error(messageFor(result.error?.code))
      }
      toast.success(
        action.type === "draft-from-published"
          ? "A new draft has been created."
          : `Edition moved to ${String(result.workflowStatus ?? action.target)}.`,
      )
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The workflow action could not be completed.",
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      aria-label="Edition workflow actions"
      style={{
        background: "var(--theme-elevation-50)",
        border: "1px solid var(--theme-elevation-150)",
        borderRadius: "0.5rem",
        marginBottom: "1.25rem",
        padding: "1rem",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "0.75rem",
          justifyContent: "space-between",
        }}
      >
        <div>
          <p
            style={{
              color: "#2563eb",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.1em",
              margin: 0,
            }}
          >
            WORKFLOW
          </p>
          <strong
            style={{
              alignItems: "center",
              display: "inline-flex",
              gap: "0.5rem",
              marginTop: "0.35rem",
              fontWeight: 400,
            }}
          >
            <span style={{ color: "var(--theme-elevation-600)", fontSize: "0.82rem" }}>
              Current state:
            </span>
            <span
              style={{
                background: WORKFLOW_BADGE[statusValue].bg,
                borderRadius: "999px",
                color: WORKFLOW_BADGE[statusValue].fg,
                fontSize: "0.78rem",
                fontWeight: 700,
                letterSpacing: "0.02em",
                padding: "0.25rem 0.7rem",
                textTransform: "capitalize",
              }}
            >
              {statusValue}
            </span>
          </strong>
        </div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}
        >
          {actions.map((action) => (
            <button
              disabled={pending !== null}
              key={action.label}
              onClick={() => void run(action)}
              style={buttonStyle(action.tone, pending !== null)}
              type="button"
            >
              {pending === action.label ? "Working…" : action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

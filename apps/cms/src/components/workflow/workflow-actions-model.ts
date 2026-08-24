import type { Tone } from "../ui/tone"

export type WorkflowStatus =
  | "draft"
  | "generating"
  | "review"
  | "approved"
  | "compiled"
  | "published"
  | "archived"

/**
 * Coarse progress signal for the status badge — draft/archived are quiet
 * terminal states, generating/approved/compiled are all "in flight",
 * review needs a human decision, and published is the only true success.
 * The status text itself still carries the precise state.
 */
export const WORKFLOW_TONE: Record<WorkflowStatus, Tone> = {
  approved: "accent",
  archived: "neutral",
  compiled: "accent",
  draft: "neutral",
  generating: "accent",
  published: "success",
  review: "warning",
}

export type WorkflowAction = {
  readonly label: string
  readonly tone: "primary" | "secondary"
  readonly target?: WorkflowStatus
  readonly type: "draft-from-published" | "publish-operation" | "transition"
}

export const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "draft" ||
  value === "generating" ||
  value === "review" ||
  value === "approved" ||
  value === "compiled" ||
  value === "published" ||
  value === "archived"

export const workflowActionsFor = (
  role: unknown,
  state: WorkflowStatus,
): readonly WorkflowAction[] => {
  if (role === "editor" && state === "draft") {
    return [
      {
        label: "开始生成",
        target: "generating",
        tone: "primary",
        type: "transition",
      },
    ]
  }
  if (role === "editor" && state === "generating") {
    return [
      {
        label: "提交审核",
        target: "review",
        tone: "primary",
        type: "transition",
      },
      {
        label: "退回草稿",
        target: "draft",
        tone: "secondary",
        type: "transition",
      },
    ]
  }
  if (role === "reviewer" && state === "review") {
    return [
      { label: "批准版本", target: "approved", tone: "primary", type: "transition" },
      { label: "退回修改", target: "draft", tone: "secondary", type: "transition" },
    ]
  }
  if (role === "publisher" && state === "compiled") {
    return [{ label: "发布版本", tone: "primary", type: "publish-operation" }]
  }
  if (role === "publisher" && state === "published") {
    return [{ label: "归档版本", target: "archived", tone: "secondary", type: "transition" }]
  }
  if (role === "editor" && state === "published") {
    return [{ label: "创建新草稿", tone: "primary", type: "draft-from-published" }]
  }
  return []
}

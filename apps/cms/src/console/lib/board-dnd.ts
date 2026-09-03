import {
  isWorkflowStatus,
  type WorkflowAction,
  workflowActionsFor,
} from "../../components/workflow/workflow-actions-model"

import type { BoardColumnKey } from "./board-model"

/*
 * Drag-and-drop mapping for the workbench board: given a card's workflow
 * status, the acting role, and the target column, resolve the workflow
 * action the drop should perform — or null when the move is not a legal
 * transition. Column keys map onto action targets; publish has no target
 * and is matched by its action type. The derived "rejected" column accepts
 * the reviewer request-changes decision (审核不通过 sends the card back to
 * draft while it keeps showing in the rejected lane). An approved card
 * dropped on 已发布 opens the publication schedule dialog instead of a
 * direct transition (compile + publish run through the release pipeline).
 */
export type BoardDropAction =
  | WorkflowAction
  | { readonly label: string; readonly tone: "primary"; readonly type: "publish-schedule" }

const COLUMN_MATCHERS: Readonly<Record<BoardColumnKey, (action: WorkflowAction) => boolean>> = {
  approved: (action) => action.target === "approved",
  archived: (action) => action.target === "archived",
  draft: (action) => action.target === "draft" || action.type === "draft-from-published",
  published: (action) => action.type === "publish-operation",
  rejected: (action) => action.type === "reviewer-request-changes",
  review: (action) => action.target === "review",
}

const SCHEDULE_ROLES: readonly string[] = ["publisher", "super-admin"]

export const dropActionFor = (
  role: string,
  workflowStatus: string,
  targetColumn: BoardColumnKey,
): BoardDropAction | null => {
  if (!isWorkflowStatus(workflowStatus)) return null
  if (
    workflowStatus === "approved" &&
    targetColumn === "published" &&
    SCHEDULE_ROLES.includes(role)
  ) {
    return { label: "创建发布排期", tone: "primary", type: "publish-schedule" }
  }
  const matcher = COLUMN_MATCHERS[targetColumn]
  if (matcher === undefined) return null
  return workflowActionsFor(role, workflowStatus, "zh").find(matcher) ?? null
}

export const canDragCard = (role: string, workflowStatus: string): boolean => {
  if (!isWorkflowStatus(workflowStatus)) return false
  /* approved cards move via the schedule dialog when dropped on 已发布. */
  if (workflowStatus === "approved") return SCHEDULE_ROLES.includes(role)
  /* archived is the terminal state: no legal moves exist by design. */
  return workflowActionsFor(role, workflowStatus, "zh").length > 0
}

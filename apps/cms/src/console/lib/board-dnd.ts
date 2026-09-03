import {
  isWorkflowStatus,
  type WorkflowAction,
  workflowStatusLabel,
} from "../../components/workflow/workflow-actions-model"

import { BOARD_COLUMNS, type BoardColumnKey } from "./board-model"

/*
 * Free-flow drag mapping (2026-09 redesign): cards move freely between the
 * six lanes. Dropping on 已发布 opens the publication schedule (the compile
 * + publish pipeline stays authoritative); dropping on 不通过 is the reject
 * decision and lands the card in the rejected lane; dropping back on the
 * card's own lane is a reorder no-op.
 */
export type BoardDropAction =
  | WorkflowAction
  | { readonly label: string; readonly tone: "primary"; readonly type: "publish-schedule" }

const PUBLISHABLE_STATUSES = ["approved", "compiled"] as const

const columnLabelOf = (column: BoardColumnKey): string =>
  BOARD_COLUMNS.find((entry) => entry.key === column)?.label ?? column

export const dropActionFor = (
  role: string,
  workflowStatus: string,
  targetColumn: BoardColumnKey,
): BoardDropAction | null => {
  void role
  if (!isWorkflowStatus(workflowStatus)) return null

  if (targetColumn === "published") {
    return PUBLISHABLE_STATUSES.includes(workflowStatus as never)
      ? { label: "创建发布排期", tone: "primary", type: "publish-schedule" }
      : null
  }

  if (targetColumn === "rejected") {
    if (workflowStatus === "draft") return null
    return {
      confirm: true,
      label: "审核不通过",
      reasonRequired: true,
      target: "draft",
      tone: "secondary",
      type: "transition",
    }
  }

  const targetStatus = targetColumn === "draft" ? "draft" : targetColumn
  if (targetStatus === workflowStatus) return null
  return {
    label: `移至${columnLabelOf(targetColumn)}`,
    target: targetStatus as WorkflowAction["target"],
    tone: "secondary",
    type: "transition",
  }
}

/* Free flow: every lane card is draggable — drop targets decide legality. */
export const canDragCard = (role: string, workflowStatus: string): boolean => {
  void role
  return isWorkflowStatus(workflowStatus)
}

/*
 * The lane a card currently sits in (mirrors board-model's boardColumnOf,
 * derived from the card snapshot instead of the raw edition). Dropping back
 * onto this lane is a no-op reorder, not a workflow request.
 */
export const ownColumnOf = (card: {
  readonly rejectedReason?: string | null
  readonly workflowStatus: string
}): BoardColumnKey | null => {
  if (!isWorkflowStatus(card.workflowStatus)) return null
  switch (card.workflowStatus) {
    case "review":
      return "review"
    case "approved":
    case "compiled":
      return "approved"
    case "published":
      return "published"
    case "archived":
      return "archived"
    default:
      return card.rejectedReason != null ? "rejected" : "draft"
  }
}

/*
 * Actionable guidance for refused drops: tell the operator why the lane
 * refuses the card and where the move has to happen instead of a bare
 * "not allowed".
 */
export const dropHintFor = (
  card: { readonly rejectedReason?: string | null; readonly workflowStatus: string },
  targetColumn: BoardColumnKey,
): string => {
  void card
  const target = columnLabelOf(targetColumn)
  if (targetColumn === "published") {
    return `发布走排期链路：请先把稿件移到「通过待发布」，再拖到「${target}」安排发布`
  }
  if (targetColumn === "rejected") {
    return `「${target}」记录审阅决定：稿件会退回草稿并标注不通过原因`
  }
  return `没有移动到「${target}」的合法操作`
}

export const laneStatusLabel = workflowStatusLabel

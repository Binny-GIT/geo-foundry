import type { WorkflowAction } from "@/components/workflow/workflow-actions-model"

/**
 * Pure helpers shared by the surfaces that trigger edition workflow actions
 * (workbench board + article detail panel). Endpoints and error codes stay
 * identical to the protected workflow APIs.
 */

export const EDITION_ACTION_ERRORS: Readonly<Record<string, string>> = {
  EDITION_WORKFLOW_ASSESSMENT_REQUIRED: "需要先通过一次质量评估。",
  EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED: "质量评估未通过，无法执行此操作。",
  EDITION_WORKFLOW_STALE_ASSESSMENT: "质量评估已过期，请重新运行质量检查。",
  EDITION_WORKFLOW_REASON_REQUIRED: "审核不通过需填写原因。",
  EDITION_WORKFLOW_STALE: "该稿件已在别处变化，请刷新后重试。",
  EDITION_WORKFLOW_REVISION_CONFLICT: "该稿件已在别处变化，请刷新后重试。",
  EDITION_WORKFLOW_NOT_COMPILED: "该稿件尚未编译。",
  EDITION_WORKFLOW_PUBLISHER_REQUIRED: "只有发布者角色可以执行发布操作。",
}

export const editionActionErrorMessage = (code: unknown): string =>
  (typeof code === "string" ? EDITION_ACTION_ERRORS[code] : undefined) ??
  (typeof code === "string" && code.length > 0
    ? `操作未能完成（${code}），请刷新后重试。`
    : "操作未能完成，请刷新后重试。")

export const editionWorkflowEndpointOf = (action: WorkflowAction, id: number): string =>
  /*
   * Free-flow model: archive/restore/审核流转 all go through the transition
   * endpoint with an explicit target; publishing keeps its operation ledger.
   * Schedule-type actions never fetch from here — the UI opens the plan
   * dialog instead.
   */
  action.type === "publish-operation"
    ? `/api/editions/${id}/publish-operations`
    : `/api/editions/${id}/workflow-transitions`

export const workflowActionBodyOf = (action: WorkflowAction): Record<string, unknown> =>
  action.type === "transition" || action.type === "archive" || action.type === "restore"
    ? { target: action.target }
    : {}

export const editionEvaluationEndpointOf = (id: number): string =>
  `/api/workspaces/editor/editions/${id}/evaluation-operations`

export const editionCommentEndpointOf = (id: number): string =>
  `/api/editions/${id}/review-comments`

export const publicationPlanEndpoint = "/api/publication-plan-operations"

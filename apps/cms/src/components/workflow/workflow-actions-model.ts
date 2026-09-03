import { type UiLang, uiLangOf } from "../i18n/ui-lang"
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

/*
 * The six lanes operators see: generating folds into 草稿 and compiled into
 * 通过待发布 (both remain internal pipeline states underneath).
 */
const LANE_LABEL: Record<WorkflowStatus, string> = {
  approved: "通过待发布",
  archived: "已删除",
  compiled: "通过待发布",
  draft: "草稿",
  generating: "草稿",
  published: "已发布",
  review: "待审核",
}

const STATUS_LABEL: Record<UiLang, Record<WorkflowStatus, string>> = {
  en: {
    approved: "Approved",
    archived: "Archived",
    compiled: "Compiled",
    draft: "Draft",
    generating: "Draft",
    published: "Published",
    review: "In review",
  },
  zh: LANE_LABEL,
}

/** Lane-facing workflow state for custom admin surfaces. */
export const workflowStatusLabel = (state: WorkflowStatus, language?: unknown): string =>
  STATUS_LABEL[uiLangOf(language)][state]

export const workflowLaneLabel = workflowStatusLabel

export type WorkflowAction = {
  readonly confirm?: true
  readonly label: string
  readonly reasonRequired?: true
  readonly tone: "primary" | "secondary"
  readonly target?: WorkflowStatus
  readonly type:
    | "archive"
    | "publish-operation"
    | "restore"
    | "schedule"
    | "transition"
}

export const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "draft" ||
  value === "generating" ||
  value === "review" ||
  value === "approved" ||
  value === "compiled" ||
  value === "published" ||
  value === "archived"

type ActionTemplate = {
  readonly confirm?: true
  readonly en: string
  readonly reasonRequired?: true
  readonly target?: WorkflowStatus
  readonly tone: "primary" | "secondary"
  readonly type:
    | "archive"
    | "publish-operation"
    | "restore"
    | "schedule"
    | "transition"
  readonly zh: string
}

/*
 * Simplified operator model (2026-09 redesign): every console role gets the
 * same lane actions; audit records identity. Publishing stays on the
 * schedule/compile pipeline, archiving is 删除, and archived cards can be
 * restored back to draft. 开始生成/质量检查/退回草稿/创建新草稿 are gone.
 */
const ACTION_TEMPLATES: readonly ActionTemplate[] = [
  // draft → review
  { en: "Submit for review", target: "review", tone: "primary", type: "transition", zh: "提交审核" },
  // review decision (不通过 returns the card to draft inside the rejected lane)
  {
    confirm: true,
    en: "Approve",
    target: "approved",
    tone: "primary",
    type: "transition",
    zh: "审核通过",
  },
  {
    confirm: true,
    reasonRequired: true,
    en: "Reject",
    target: "draft",
    tone: "secondary",
    type: "transition",
    zh: "审核不通过",
  },
  // approved → publish via schedule; compiled ships directly
  { en: "Schedule publish", tone: "primary", type: "schedule", zh: "创建发布排期" },
  { confirm: true, en: "Publish now", tone: "primary", type: "publish-operation", zh: "发布版本" },
  // published → archived (删除)
  {
    confirm: true,
    en: "Delete edition",
    target: "archived",
    tone: "secondary",
    type: "archive",
    zh: "删除",
  },
  // archived → draft (恢复)
  { confirm: true, en: "Restore edition", target: "draft", tone: "primary", type: "restore", zh: "恢复" },
]

/*
 * Per-lane action sets. The keys use lane states only (generating/compiled
 * inherit from their lane neighbours).
 */
const TEMPLATE_KEYS: Record<WorkflowStatus, readonly number[]> = {
  approved: [3],
  archived: [6],
  compiled: [4, 3],
  draft: [0],
  generating: [0],
  published: [5],
  review: [1, 2],
}

/** Bilingual workflow action list; labels resolve per UI language (zh default). */
export const workflowActionsFor = (
  role: unknown,
  state: WorkflowStatus,
  language?: unknown,
): readonly WorkflowAction[] => {
  void role // 自由流转模型下不再按角色区分；保留参数兼容既有调用方
  const lang: UiLang = uiLangOf(language)
  const actions: WorkflowAction[] = []
  for (const key of TEMPLATE_KEYS[state] ?? []) {
    const template = ACTION_TEMPLATES[key]
    if (template === undefined) continue
    actions.push({
      ...(template.confirm === true ? { confirm: true } : {}),
      label: template[lang],
      ...(template.reasonRequired === true ? { reasonRequired: true } : {}),
      ...(template.target !== undefined ? { target: template.target } : {}),
      tone: template.tone,
      type: template.type,
    })
  }
  return actions
}

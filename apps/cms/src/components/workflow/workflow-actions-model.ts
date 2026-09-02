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

const STATUS_LABEL: Record<UiLang, Record<WorkflowStatus, string>> = {
  en: {
    approved: "Approved",
    archived: "Archived",
    compiled: "Compiled",
    draft: "Draft",
    generating: "Generating",
    published: "Published",
    review: "In review",
  },
  zh: {
    approved: "已批准",
    archived: "已归档",
    compiled: "已编译",
    draft: "草稿",
    generating: "生成中",
    published: "已发布",
    review: "审核中",
  },
}

/** Human-readable workflow state for custom admin surfaces. */
export const workflowStatusLabel = (state: WorkflowStatus, language?: unknown): string =>
  STATUS_LABEL[uiLangOf(language)][state]

export type WorkflowAction = {
  readonly confirm?: true
  readonly label: string
  readonly reasonRequired?: true
  readonly tone: "primary" | "secondary"
  readonly target?: WorkflowStatus
  readonly type:
    | "draft-from-published"
    | "publish-operation"
    | "reviewer-approve"
    | "reviewer-request-changes"
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
    | "draft-from-published"
    | "publish-operation"
    | "reviewer-approve"
    | "reviewer-request-changes"
    | "transition"
  readonly zh: string
}

const ACTION_TEMPLATES: readonly ActionTemplate[] = [
  // editor: draft → generating
  {
    en: "Start generating",
    target: "generating",
    tone: "primary",
    type: "transition",
    zh: "开始生成",
  },
  // editor: generating → review / back to draft
  {
    en: "Submit for review",
    target: "review",
    tone: "primary",
    type: "transition",
    zh: "提交审核",
  },
  { en: "Return to draft", target: "draft", tone: "secondary", type: "transition", zh: "退回草稿" },
  // reviewer: review → approved / back to draft
  {
    confirm: true,
    en: "Approve edition",
    target: "approved",
    tone: "primary",
    type: "reviewer-approve",
    zh: "审核通过",
  },
  {
    confirm: true,
    en: "Request changes",
    reasonRequired: true,
    target: "draft",
    tone: "secondary",
    type: "reviewer-request-changes",
    zh: "审核不通过",
  },
  // publisher: compiled → publish
  {
    confirm: true,
    en: "Publish edition",
    tone: "primary",
    type: "publish-operation",
    zh: "发布版本",
  },
  // publisher: published → archived
  {
    confirm: true,
    en: "Archive edition",
    target: "archived",
    tone: "secondary",
    type: "transition",
    zh: "归档版本",
  },
  // editor: published → new draft
  {
    confirm: true,
    en: "Create next draft",
    tone: "primary",
    type: "draft-from-published",
    zh: "创建新草稿",
  },
]

const TEMPLATE_KEYS: Record<string, readonly number[]> = {
  "editor:draft": [0],
  "editor:generating": [1, 2],
  "editor:published": [7],
  "publisher:compiled": [5],
  "publisher:published": [6],
  "reviewer:review": [3, 4],
}

/** Bilingual workflow action list; labels resolve per UI language (zh default). */
export const workflowActionsFor = (
  role: unknown,
  state: WorkflowStatus,
  language?: unknown,
): readonly WorkflowAction[] => {
  const lang: UiLang = uiLangOf(language)
  const actions: WorkflowAction[] = []
  for (const key of TEMPLATE_KEYS[`${String(role)}:${state}`] ?? []) {
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

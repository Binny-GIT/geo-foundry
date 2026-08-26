export type RecordLike = Record<string, unknown>

type IdRecord = {
  readonly id?: unknown
}

type EditionApiRecord = IdRecord & {
  readonly angle?: unknown
  readonly body?: unknown
  readonly citations?: unknown
  readonly content?: unknown
  readonly creationOrigin?: unknown
  readonly entities?: unknown
  readonly primaryTopic?: unknown
  readonly secondaryTopics?: unknown
  readonly site?: unknown
  readonly summary?: unknown
  readonly title?: unknown
  readonly workflowRevision?: unknown
  readonly workflowStatus?: unknown
}

export type EditionWorkflowStatus =
  | "draft"
  | "generating"
  | "review"
  | "approved"
  | "compiled"
  | "published"
  | "archived"

export type EditionCreationOrigin = "ai" | "human" | "hybrid"

export type ContentEditionDraft = {
  readonly angle: string
  readonly body: readonly RecordLike[]
  readonly citations: unknown
  readonly content: string
  readonly creationOrigin: EditionCreationOrigin
  readonly entities: unknown
  readonly primaryTopic: string
  readonly secondaryTopics: readonly string[]
  readonly site: string
  readonly summary: string
  readonly title: string
}

export type ContentEditionDocument = ContentEditionDraft & {
  readonly id: string
  readonly workflowRevision: number
  readonly workflowStatus: EditionWorkflowStatus | null
}

export const EDITION_EDITABLE_FIELDS = [
  "content",
  "site",
  "angle",
  "title",
  "summary",
  "body",
  "primaryTopic",
  "secondaryTopics",
  "citations",
  "entities",
  "creationOrigin",
] as const

const CREATION_ORIGINS: readonly EditionCreationOrigin[] = ["ai", "human", "hybrid"]

const WORKFLOW_STATUSES: readonly EditionWorkflowStatus[] = [
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
]

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

export const relationId = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null) {
    const id = (value as IdRecord).id
    if (typeof id === "string" || typeof id === "number") return String(id)
  }
  return ""
}

const recordArray = (value: unknown): readonly RecordLike[] =>
  Array.isArray(value)
    ? value.filter((item): item is RecordLike => typeof item === "object" && item !== null)
    : []

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : []

export const isEditionCreationOrigin = (value: unknown): value is EditionCreationOrigin =>
  CREATION_ORIGINS.includes(value as EditionCreationOrigin)

export const isEditionWorkflowStatus = (value: unknown): value is EditionWorkflowStatus =>
  WORKFLOW_STATUSES.includes(value as EditionWorkflowStatus)

export const defaultContentEditionDraft = (): ContentEditionDraft => ({
  angle: "",
  body: [],
  citations: null,
  content: "",
  creationOrigin: "human",
  entities: null,
  primaryTopic: "",
  secondaryTopics: [],
  site: "",
  summary: "",
  title: "",
})

export const mapContentEditionDocument = (value: unknown): ContentEditionDocument => {
  const source = typeof value === "object" && value !== null ? (value as EditionApiRecord) : {}
  const draft = {
    angle: stringValue(source.angle),
    body: recordArray(source.body),
    citations: source.citations ?? null,
    content: relationId(source.content),
    creationOrigin: isEditionCreationOrigin(source.creationOrigin)
      ? source.creationOrigin
      : "human",
    entities: source.entities ?? null,
    primaryTopic: stringValue(source.primaryTopic),
    secondaryTopics: stringArray(source.secondaryTopics),
    site: relationId(source.site),
    summary: stringValue(source.summary),
    title: stringValue(source.title),
  } satisfies ContentEditionDraft

  const revision = source.workflowRevision
  return {
    ...draft,
    id: relationId(source.id),
    workflowRevision: typeof revision === "number" && Number.isSafeInteger(revision) ? revision : 0,
    workflowStatus: isEditionWorkflowStatus(source.workflowStatus)
      ? source.workflowStatus
      : null,
  }
}

/**
 * Produces the only fields a human Console form may send to Payload's edition
 * collection. Server-owned tenant, workflow, release, audit, and timestamps
 * are intentionally absent.
 */
export const editableContentEditionPayload = (draft: ContentEditionDraft): RecordLike => ({
  angle: draft.angle.trim(),
  body: [...draft.body],
  citations: draft.citations,
  content: draft.content,
  creationOrigin: draft.creationOrigin,
  entities: draft.entities,
  primaryTopic: draft.primaryTopic.trim(),
  secondaryTopics: draft.secondaryTopics.map((topic) => topic.trim()).filter(Boolean),
  site: draft.site,
  summary: draft.summary.trim(),
  title: draft.title.trim(),
})

export type EditionWorkflowAction =
  | "draft-from-published"
  | "publish-operation"
  | "reviewer-approve"
  | "reviewer-request-changes"
  | "transition"

export type EditionWorkflowActionDefinition = {
  readonly confirm: boolean
  readonly label: string
  readonly reasonRequired: boolean
  readonly target?: EditionWorkflowStatus
  readonly type: EditionWorkflowAction
}

const action = (
  label: string,
  type: EditionWorkflowAction,
  options: Omit<EditionWorkflowActionDefinition, "label" | "type"> = {
    confirm: false,
    reasonRequired: false,
  },
): EditionWorkflowActionDefinition => ({ label, type, ...options })

export const editionWorkflowActionsFor = (
  role: unknown,
  status: EditionWorkflowStatus | null,
): readonly EditionWorkflowActionDefinition[] => {
  switch (`${String(role)}:${status ?? ""}`) {
    case "editor:draft":
      return [
        action("开始生成", "transition", {
          confirm: false,
          reasonRequired: false,
          target: "generating",
        }),
      ]
    case "editor:generating":
      return [
        action("提交审核", "transition", {
          confirm: false,
          reasonRequired: false,
          target: "review",
        }),
        action("退回草稿", "transition", {
          confirm: false,
          reasonRequired: false,
          target: "draft",
        }),
      ]
    case "editor:published":
      return [
        action("创建下一草稿", "draft-from-published", {
          confirm: true,
          reasonRequired: false,
        }),
      ]
    case "reviewer:review":
      return [
        action("批准版本", "reviewer-approve", { confirm: true, reasonRequired: false }),
        action("退回修改", "reviewer-request-changes", { confirm: true, reasonRequired: true }),
      ]
    case "publisher:compiled":
      return [action("发布版本", "publish-operation", { confirm: true, reasonRequired: false })]
    case "publisher:published":
      return [
        action("归档版本", "transition", {
          confirm: true,
          reasonRequired: false,
          target: "archived",
        }),
      ]
    default:
      return []
  }
}

export const contentEditionWorkflowRequest = (
  id: string,
  actionDefinition: EditionWorkflowActionDefinition,
  workflowRevision: number,
  reason?: string,
): {
  readonly body: RecordLike
  readonly endpoint: string
  readonly headers?: Record<string, string>
} => {
  const normalizedReason = reason?.trim()
  const withReason =
    normalizedReason === undefined || normalizedReason.length === 0
      ? {}
      : { reason: normalizedReason }

  switch (actionDefinition.type) {
    case "draft-from-published":
      return {
        body: withReason,
        endpoint: `/api/editions/${encodeURIComponent(id)}/draft-from-published`,
      }
    case "publish-operation":
      return {
        body: withReason,
        endpoint: `/api/editions/${encodeURIComponent(id)}/publish-operations`,
      }
    case "reviewer-approve":
      return {
        body: { expectedRevision: workflowRevision },
        endpoint: `/api/workspaces/reviewer/editions/${encodeURIComponent(id)}/approve`,
        headers: {
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      }
    case "reviewer-request-changes":
      return {
        body: { expectedRevision: workflowRevision, ...withReason },
        endpoint: `/api/workspaces/reviewer/editions/${encodeURIComponent(id)}/request-changes`,
        headers: {
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      }
    case "transition":
      return {
        body: { target: actionDefinition.target, ...withReason },
        endpoint: `/api/editions/${encodeURIComponent(id)}/workflow-transitions`,
      }
  }
}

/**
 * Pure mapping from edition documents to workbench board columns. The backend
 * workflow states stay untouched (draft/generating/review/approved/compiled/
 * published/archived); this model only projects them into the operator's
 * six-column review board.
 */

export type BoardColumnKey = "draft" | "review" | "approved" | "rejected" | "published" | "archived"

export type BoardColumn = {
  readonly key: BoardColumnKey
  readonly label: string
}

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { key: "draft", label: "草稿" },
  { key: "review", label: "待审核" },
  { key: "approved", label: "通过待发布" },
  { key: "rejected", label: "不通过" },
  { key: "published", label: "已发布" },
  { key: "archived", label: "已删除" },
]

export type BoardCard = {
  readonly id: number
  readonly ownerEmail: string | null
  readonly rejectedReason: string | null
  readonly siteName: string | null
  readonly siteTimezone: string | null
  readonly title: string
  readonly updatedAt: string | null
  readonly workflowRevision: number
  readonly workflowStatus: string
}

const WORKFLOW_STATUSES: readonly string[] = [
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
]

const lastTransitionOf = (edition: Record<string, unknown>): Record<string, unknown> | null => {
  const audit = edition["auditLog"]
  if (!Array.isArray(audit)) return null
  for (let index = audit.length - 1; index >= 0; index -= 1) {
    const entry = audit[index]
    if (typeof entry === "object" && entry !== null) {
      const action = (entry as Record<string, unknown>)["action"]
      if (typeof action === "string" && action.startsWith("content-edition.")) {
        return entry as Record<string, unknown>
      }
    }
  }
  return null
}

export const boardColumnOf = (edition: Record<string, unknown>): BoardColumnKey | null => {
  const status = edition["workflowStatus"]
  if (typeof status !== "string" || !WORKFLOW_STATUSES.includes(status)) return null
  if (status === "review") return "review"
  if (status === "approved" || status === "compiled") return "approved"
  if (status === "published") return "published"
  if (status === "archived") return "archived"
  const lastTransition = lastTransitionOf(edition)
  return lastTransition !== null && lastTransition["action"] === "content-edition.review.draft"
    ? "rejected"
    : "draft"
}

const relationshipText = (value: unknown, field: string): string | null => {
  if (typeof value !== "object" || value === null) return null
  const text = (value as Record<string, unknown>)[field]
  return typeof text === "string" && text.length > 0 ? text : null
}

const rejectedReasonOf = (edition: Record<string, unknown>): string | null => {
  const lastTransition = lastTransitionOf(edition)
  if (lastTransition === null || lastTransition["action"] !== "content-edition.review.draft") {
    return null
  }
  const reason = lastTransition["reason"]
  return typeof reason === "string" && reason.length > 0 ? reason : null
}

export const boardCardOf = (edition: Record<string, unknown>): BoardCard | null => {
  const column = boardColumnOf(edition)
  const id = edition["id"]
  const status = edition["workflowStatus"]
  if (column === null || typeof id !== "number" || typeof status !== "string") return null
  const title = edition["title"]
  const revision = edition["workflowRevision"]
  const updatedAt = edition["updatedAt"]
  return {
    id,
    ownerEmail: relationshipText(edition["owner"], "email"),
    rejectedReason: rejectedReasonOf(edition),
    siteName: relationshipText(edition["site"], "name"),
    siteTimezone: relationshipText(edition["site"], "timezone"),
    title: typeof title === "string" && title.length > 0 ? title : "未命名稿件",
    updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    workflowRevision: typeof revision === "number" ? revision : 0,
    workflowStatus: status,
  }
}

export const groupBoardCards = (
  editions: readonly Record<string, unknown>[],
): Readonly<Record<BoardColumnKey, readonly BoardCard[]>> => {
  const grouped: Record<BoardColumnKey, BoardCard[]> = {
    approved: [],
    archived: [],
    draft: [],
    published: [],
    rejected: [],
    review: [],
  }
  for (const edition of editions) {
    const card = boardCardOf(edition)
    if (card === null) continue
    grouped[boardColumnOf(edition) as BoardColumnKey].push(card)
  }
  return grouped
}

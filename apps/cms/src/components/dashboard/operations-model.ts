export type RecordLike = Record<string, unknown>

export const recordsOf = (value: unknown): RecordLike[] => value as RecordLike[]

export const WORKFLOW_STATES = [
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
] as const

export type WorkflowState = (typeof WORKFLOW_STATES)[number]

export const idOf = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null) {
    const id = (value as RecordLike)["id"]
    return typeof id === "string" || typeof id === "number" ? String(id) : null
  }
  return null
}

export const stringOf = (value: unknown, fallback = "—"): string =>
  typeof value === "string" && value.length > 0 ? value : fallback

export const formatDate = (value: unknown): string => {
  if (typeof value !== "string") return "Recently"
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return "Recently"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export const shortHash = (value: unknown): string => {
  const hash = stringOf(value, "")
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash || "—"
}

export const isWorkflowState = (value: unknown): value is WorkflowState =>
  typeof value === "string" && (WORKFLOW_STATES as readonly string[]).includes(value)

export const workflowCounts = (editions: readonly RecordLike[]): Record<WorkflowState, number> => {
  const counts = Object.fromEntries(WORKFLOW_STATES.map((status) => [status, 0])) as Record<
    WorkflowState,
    number
  >
  for (const edition of editions) {
    const status = edition["workflowStatus"]
    if (isWorkflowState(status)) counts[status] += 1
  }
  return counts
}

export const siteWorkflowSummary = (counts: Record<WorkflowState, number>): string =>
  `${counts.draft} draft · ${counts.review} review · ${counts.approved} approved · ${counts.compiled} compiled · ${counts.published} published`

export type DomainSummary = {
  readonly aliases: number
  readonly canonicalDisabled: boolean
  readonly canonicalHostname: string | null
  readonly configured: boolean
}

export const summarizeDomains = (domains: readonly RecordLike[]): Map<string, DomainSummary> => {
  const grouped = new Map<string, RecordLike[]>()
  for (const domain of domains) {
    const siteId = idOf(domain["site"])
    if (siteId === null) continue
    const rows = grouped.get(siteId) ?? []
    rows.push(domain)
    grouped.set(siteId, rows)
  }

  return new Map(
    [...grouped.entries()].map(([siteId, rows]) => {
      const activeCanonical = rows.find(
        (domain) => domain["role"] === "canonical" && domain["status"] === "active",
      )
      const disabledCanonical = rows.some(
        (domain) => domain["role"] === "canonical" && domain["status"] === "disabled",
      )
      const activeAliases = rows.filter(
        (domain) => domain["role"] === "alias" && domain["status"] === "active",
      ).length
      return [
        siteId,
        {
          aliases: activeAliases,
          canonicalDisabled: disabledCanonical,
          canonicalHostname:
            activeCanonical === undefined ? null : stringOf(activeCanonical["hostname"]),
          configured: rows.length > 0,
        },
      ]
    }),
  )
}

export const groupBySite = (rows: readonly RecordLike[]): Map<string, RecordLike[]> => {
  const grouped = new Map<string, RecordLike[]>()
  for (const row of rows) {
    const siteId = idOf(row["site"])
    if (siteId === null) continue
    const items = grouped.get(siteId) ?? []
    items.push(row)
    grouped.set(siteId, items)
  }
  return grouped
}

export const countIssues = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

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
export type DashboardLanguage = "en" | "zh"

export const OPERATION_TYPES = ["generate", "evaluate", "publish", "rollback"] as const
export type OperationType = (typeof OPERATION_TYPES)[number]

export const OPERATION_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const
export type OperationState = (typeof OPERATION_STATES)[number]

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

export const formatDate = (value: unknown, lang: DashboardLanguage = "en"): string => {
  if (typeof value !== "string") return lang === "zh" ? "最近" : "Recently"
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return lang === "zh" ? "最近" : "Recently"
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
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

export const isOperationType = (value: unknown): value is OperationType =>
  typeof value === "string" && (OPERATION_TYPES as readonly string[]).includes(value)

export const isOperationState = (value: unknown): value is OperationState =>
  typeof value === "string" && (OPERATION_STATES as readonly string[]).includes(value)

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

export const workflowBottleneck = (
  counts: Record<WorkflowState, number>,
): { readonly count: number; readonly state: WorkflowState } | null => {
  const actionable = ["draft", "generating", "review", "approved", "compiled"] as const
  const state = actionable.reduce<WorkflowState>(
    (largest, candidate) => (counts[candidate] > counts[largest] ? candidate : largest),
    "draft",
  )
  return counts[state] > 0 ? { count: counts[state], state } : null
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

export type SiteReadiness = "configure" | "disabled" | "publish" | "ready" | "restricted"

export type SiteReadinessRow = {
  readonly counts: Record<WorkflowState, number>
  readonly id: string
  readonly readiness: SiteReadiness
}

export const siteReadiness = ({
  canReadReleases,
  currentReleaseSiteIds,
  domains,
  editionsBySite,
  sites,
}: {
  readonly canReadReleases: boolean
  readonly currentReleaseSiteIds: ReadonlySet<string>
  readonly domains: ReadonlyMap<string, DomainSummary>
  readonly editionsBySite: ReadonlyMap<string, readonly RecordLike[]>
  readonly sites: readonly RecordLike[]
}): SiteReadinessRow[] =>
  sites.flatMap((site) => {
    const id = idOf(site)
    if (id === null) return []
    const domain = domains.get(id)
    const hasCanonical = domain?.canonicalHostname !== null && domain !== undefined
    const readiness: SiteReadiness =
      site["status"] === "disabled"
        ? "disabled"
        : !hasCanonical
          ? "configure"
          : !canReadReleases
            ? "restricted"
            : currentReleaseSiteIds.has(id)
              ? "ready"
              : "publish"
    return [{ counts: workflowCounts(editionsBySite.get(id) ?? []), id, readiness }]
  })

const readinessRank: Record<SiteReadiness, number> = {
  configure: 0,
  disabled: 3,
  publish: 1,
  ready: 4,
  restricted: 2,
}

export const sortSiteWorkload = (rows: readonly SiteReadinessRow[]): SiteReadinessRow[] =>
  [...rows].sort((left, right) => {
    const leftWork = left.counts.review + left.counts.approved + left.counts.compiled
    const rightWork = right.counts.review + right.counts.approved + right.counts.compiled
    return (
      readinessRank[left.readiness] - readinessRank[right.readiness] ||
      rightWork - leftWork ||
      left.id.localeCompare(right.id)
    )
  })

export type OperationHealth = Record<OperationType, Record<OperationState, number>>

export const operationHealth = (operations: readonly RecordLike[]): OperationHealth => {
  const health = Object.fromEntries(
    OPERATION_TYPES.map((type) => [
      type,
      Object.fromEntries(OPERATION_STATES.map((state) => [state, 0])) as Record<
        OperationState,
        number
      >,
    ]),
  ) as OperationHealth
  for (const operation of operations) {
    const type = operation["operationType"]
    const state = operation["state"]
    if (isOperationType(type) && isOperationState(state)) health[type][state] += 1
  }
  return health
}

export const countIssues = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

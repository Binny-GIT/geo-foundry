import type { RecordLike } from "../dashboard/operations-model"

export type { RecordLike } from "../dashboard/operations-model"

export const WORKSPACE_QUEUE_KINDS = ["editor", "reviewer", "publisher"] as const
export type WorkspaceQueueKind = (typeof WORKSPACE_QUEUE_KINDS)[number]

export const EDITION_WORKFLOW_STATES = [
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
] as const
export type EditionWorkflowState = (typeof EDITION_WORKFLOW_STATES)[number]

export const RELEASE_STATES = [
  "building",
  "validated",
  "uploaded",
  "current",
  "superseded",
  "rolled_back",
  "failed",
] as const
export type ReleaseState = (typeof RELEASE_STATES)[number]

export const OPERATION_TYPES = ["generate", "evaluate", "publish", "rollback"] as const
export type WorkspaceOperationType = (typeof OPERATION_TYPES)[number]

export const OPERATION_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const
export type WorkspaceOperationState = (typeof OPERATION_STATES)[number]

type LifecycleOwner = WorkspaceQueueKind | "system" | null
type ReadinessKind = "actionable" | "complete" | "in-progress" | "waiting"

export type EditionReadiness = {
  readonly kind: ReadinessKind
  readonly nextOwner: LifecycleOwner
  readonly state: EditionWorkflowState
}

export type WorkspaceEditionDto = {
  readonly editionId: string
  readonly readiness: EditionReadiness
  readonly siteId: string | null
  readonly tenantId: string | null
  readonly title: string | null
  readonly updatedAt: string | null
  readonly workflowStatus: EditionWorkflowState
}

export type LifecycleWorkspaceQueues = Readonly<
  Record<WorkspaceQueueKind, readonly WorkspaceEditionDto[]>
>

export type OperationTimelineEntry = {
  readonly action: string
  readonly actorRole: string | null
  readonly at: string | null
  readonly outcome: "failed" | "succeeded" | null
  readonly stage: string | null
}

export type OperationTimelineDisplay = {
  readonly currentStage: string | null
  readonly operationId: string
  readonly operationType: WorkspaceOperationType
  readonly state: WorkspaceOperationState
  readonly timeline: readonly OperationTimelineEntry[]
}

export type ReleaseHistoryItem = {
  readonly manifestSha256: string | null
  readonly operationId: string | null
  readonly recordedAt: string | null
  readonly releaseId: string
  readonly siteId: string | null
  readonly state: ReleaseState
  readonly tenantId: string | null
}

export type RollbackCandidate = ReleaseHistoryItem & {
  readonly currentReleaseId: string
}

const idOf = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null) return idOf((value as RecordLike)["id"])
  return null
}

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const recordOf = (value: unknown): RecordLike | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordLike)
    : null

const timestampRank = (value: string | null): number => {
  if (value === null) return 0
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const newestFirst = <
  T extends { readonly recordedAt?: string | null; readonly updatedAt?: string | null },
>(
  rows: readonly T[],
): T[] =>
  [...rows].sort(
    (left, right) =>
      timestampRank(right.recordedAt ?? right.updatedAt ?? null) -
        timestampRank(left.recordedAt ?? left.updatedAt ?? null) || 0,
  )

export const isEditionWorkflowState = (value: unknown): value is EditionWorkflowState =>
  typeof value === "string" && (EDITION_WORKFLOW_STATES as readonly string[]).includes(value)

export const isReleaseState = (value: unknown): value is ReleaseState =>
  typeof value === "string" && (RELEASE_STATES as readonly string[]).includes(value)

const isOperationType = (value: unknown): value is WorkspaceOperationType =>
  typeof value === "string" && (OPERATION_TYPES as readonly string[]).includes(value)

const isOperationState = (value: unknown): value is WorkspaceOperationState =>
  typeof value === "string" && (OPERATION_STATES as readonly string[]).includes(value)

/** Maps stored workflow state to a display-safe, non-mutating lifecycle signal. */
export const editionReadinessFor = (state: EditionWorkflowState): EditionReadiness => {
  switch (state) {
    case "draft":
      return { kind: "actionable", nextOwner: "editor", state }
    case "generating":
      return { kind: "in-progress", nextOwner: "editor", state }
    case "review":
      return { kind: "actionable", nextOwner: "reviewer", state }
    case "approved":
      return { kind: "waiting", nextOwner: "system", state }
    case "compiled":
      return { kind: "actionable", nextOwner: "publisher", state }
    case "published":
    case "archived":
      return { kind: "complete", nextOwner: null, state }
  }
}

/**
 * Converts a depth-0 Payload edition row into a deliberately small workspace DTO.
 * Invalid or incomplete rows are omitted rather than guessed at.
 */
export const workspaceEditionDtoOf = (edition: RecordLike): WorkspaceEditionDto | null => {
  const editionId = idOf(edition["id"])
  const workflowStatus = edition["workflowStatus"]
  if (editionId === null || !isEditionWorkflowState(workflowStatus)) return null

  return {
    editionId,
    readiness: editionReadinessFor(workflowStatus),
    siteId: idOf(edition["site"]),
    tenantId: idOf(edition["tenant"]),
    title: textOf(edition["title"]),
    updatedAt: textOf(edition["updatedAt"]) ?? textOf(edition["createdAt"]),
    workflowStatus,
  }
}

const queueForState = (state: EditionWorkflowState): WorkspaceQueueKind | null => {
  switch (state) {
    case "draft":
    case "generating":
      return "editor"
    case "review":
      return "reviewer"
    case "approved":
    case "compiled":
      return "publisher"
    case "published":
    case "archived":
      return null
  }
}

/**
 * Builds role queues strictly from rows already selected by the caller. It is
 * security-neutral: it does not fetch, authorize, or widen tenant scope.
 */
export const lifecycleWorkspaceQueues = (
  editions: readonly RecordLike[],
): LifecycleWorkspaceQueues => {
  const queues: Record<WorkspaceQueueKind, WorkspaceEditionDto[]> = {
    editor: [],
    publisher: [],
    reviewer: [],
  }

  for (const edition of editions) {
    const dto = workspaceEditionDtoOf(edition)
    if (dto === null) continue
    const queue = queueForState(dto.workflowStatus)
    if (queue !== null) queues[queue].push(dto)
  }

  return {
    editor: newestFirst(queues.editor),
    publisher: newestFirst(queues.publisher),
    reviewer: newestFirst(queues.reviewer),
  }
}

const timelineEntryOf = (value: unknown): OperationTimelineEntry | null => {
  const entry = recordOf(value)
  if (entry === null) return null
  const action = textOf(entry["action"])
  if (action === null) return null

  const actor = recordOf(entry["actor"])
  const detail = recordOf(entry["detail"])
  const stageMatch = /^operation\.stage\.(?:started|completed):(.+)$/.exec(action)
  const outcome = detail?.["outcome"]

  return {
    action,
    actorRole: textOf(actor?.["role"]),
    at: textOf(entry["at"]),
    outcome: outcome === "failed" || outcome === "succeeded" ? outcome : null,
    stage: stageMatch?.[1] ?? null,
  }
}

/** Converts an operations-ledger row into chronological, display-only timeline data. */
export const operationTimelineDisplayOf = (
  operation: RecordLike,
): OperationTimelineDisplay | null => {
  const operationId = textOf(operation["operationId"])
  const operationType = operation["operationType"]
  const state = operation["state"]
  if (operationId === null || !isOperationType(operationType) || !isOperationState(state))
    return null

  const timeline = Array.isArray(operation["auditLog"])
    ? operation["auditLog"]
        .map(timelineEntryOf)
        .filter((entry): entry is OperationTimelineEntry => entry !== null)
        .sort((left, right) => timestampRank(left.at) - timestampRank(right.at))
    : []

  return {
    currentStage: textOf(operation["currentStage"]),
    operationId,
    operationType,
    state,
    timeline,
  }
}

/** Normalizes a release-registry row without exposing receipt or audit payloads. */
export const releaseHistoryItemOf = (release: RecordLike): ReleaseHistoryItem | null => {
  const releaseId = textOf(release["releaseId"])
  const state = release["state"]
  if (releaseId === null || !isReleaseState(state)) return null

  return {
    manifestSha256: textOf(release["manifestSha256"]),
    operationId: textOf(release["operationId"]),
    recordedAt: textOf(release["updatedAt"]) ?? textOf(release["createdAt"]),
    releaseId,
    siteId: idOf(release["site"]),
    state,
    tenantId: idOf(release["tenant"]),
  }
}

/**
 * Returns one tenant-owned site's release history, newest first. Callers still
 * authorize their source rows; the tenant match keeps malformed cross-tenant
 * relations from being mixed into a site projection.
 */
export const releaseHistoryForSite = (
  releases: readonly RecordLike[],
  siteId: string | number,
  tenantId: string | number,
): readonly ReleaseHistoryItem[] =>
  newestFirst(
    releases
      .map(releaseHistoryItemOf)
      .filter((release): release is ReleaseHistoryItem => release !== null)
      .filter(
        (release) => release.siteId === String(siteId) && release.tenantId === String(tenantId),
      ),
  )

/**
 * Returns prior stable artifacts for the supplied site's current release.
 * Uploaded, building, validated, and failed records are intentionally not
 * presented as rollback targets.
 */
export const rollbackCandidatesForSite = (
  releases: readonly RecordLike[],
  siteId: string | number,
  tenantId: string | number,
): readonly RollbackCandidate[] => {
  const history = releaseHistoryForSite(releases, siteId, tenantId)
  const current = history.find((release) => release.state === "current")
  if (current === undefined) return []

  return history
    .filter(
      (release) =>
        release.releaseId !== current.releaseId &&
        (release.state === "superseded" || release.state === "rolled_back"),
    )
    .map((release) => ({ ...release, currentReleaseId: current.releaseId }))
}

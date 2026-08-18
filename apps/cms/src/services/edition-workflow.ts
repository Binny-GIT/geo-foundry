import {
  createUserAuditActor,
  parseContentId,
  parseEditionId,
  parseSiteId,
  parseTenantId,
  parseUserId,
  parseInstant,
  transitionContentEdition,
  createDraftEditionFromPublished,
  type AuditActor,
  type Clock,
  type ContentEdition,
  type ContentEditionState,
} from "@geo/domain"
import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { hashEditionContent, type EditionContentSnapshot } from "./edition-input-hash"

export class EditionWorkflowError extends Error {
  override readonly name = "EditionWorkflowError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail: string): EditionWorkflowError =>
  new EditionWorkflowError(code, detail)

const systemClock: Clock = {
  now: () => {
    const iso = new Date().toISOString()
    const instant = parseInstant(iso)
    if (!instant.ok) {
      throw fail("EDITION_WORKFLOW_CLOCK_INVALID", iso)
    }
    return instant.value
  },
}

type WorkflowEditionDoc = {
  readonly id: number
  readonly content: unknown
  readonly site: unknown
  readonly tenant: unknown
  readonly title: unknown
  readonly summary: unknown
  readonly body: unknown
  readonly primaryTopic: unknown
  readonly secondaryTopics: unknown
  readonly workflowStatus: unknown
  readonly workflowRevision: unknown
  readonly compiledRelease: unknown
  readonly auditLog: unknown
}

const numberField = (value: unknown): number | null => (typeof value === "number" ? value : null)

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const parseStatus = (value: unknown): ContentEditionState => {
  switch (value) {
    case "approved":
    case "archived":
    case "compiled":
    case "draft":
    case "generating":
    case "published":
    case "review":
      return value
    default:
      throw fail("EDITION_WORKFLOW_STATE_INVALID", String(value))
  }
}

export type SerializedAuditActor = {
  readonly kind: "service" | "user"
  readonly role: string
  readonly tenantId: string | number | null
  readonly userId: string
}

type AuditEntry = {
  readonly action: string
  readonly actor: SerializedAuditActor
  readonly at: string
  readonly from: ContentEditionState
  readonly reason?: string
  readonly tenantId: number
  readonly to: ContentEditionState
}

const actorOf = (user: unknown): AuditActor | null => {
  const claims = resolveSessionClaims(user)
  if (claims === null) {
    return null
  }
  const userId = parseUserId(claims.userId)
  if (!userId.ok) {
    return null
  }
  return createUserAuditActor({
    role: claims.role === "content-service" ? "editor" : claims.role,
    userId: userId.value,
  })
}

const serializedActorOf = (user: unknown): SerializedAuditActor | null => {
  const claims = resolveSessionClaims(user)
  if (claims === null) {
    return null
  }
  return {
    kind: claims.kind,
    role: claims.role,
    tenantId: claims.tenantId,
    userId: claims.userId,
  }
}

const aggregateOf = (doc: WorkflowEditionDoc): ContentEdition => {
  const editionId = parseEditionId(String(doc.id))
  const contentId = parseContentId(String(numberField(doc.content) ?? -1))
  const siteId = parseSiteId(String(numberField(doc.site) ?? -1))
  const tenantId = parseTenantId(String(numberField(doc.tenant) ?? -1))
  if (!editionId.ok || !contentId.ok || !siteId.ok || !tenantId.ok) {
    throw fail("EDITION_WORKFLOW_ROW_INVALID", `edition ${doc.id} identity`)
  }
  return Object.freeze({
    audit: [],
    contentId: contentId.value,
    id: editionId.value,
    ownership: Object.freeze({
      scope: "site" as const,
      siteId: siteId.value,
      tenantId: tenantId.value,
    }),
    revision: numberField(doc.workflowRevision) ?? 0,
    state: parseStatus(doc.workflowStatus),
    version: 1,
  })
}

const snapshotOf = (doc: WorkflowEditionDoc): EditionContentSnapshot => ({
  body: doc.body,
  primaryTopic: doc.primaryTopic,
  secondaryTopics: doc.secondaryTopics,
  summary: doc.summary,
  title: doc.title,
})

const loadEdition = async (payload: Payload, editionId: number): Promise<WorkflowEditionDoc> => {
  const doc = (await payload.findByID({
    collection: "content-editions",
    id: editionId,
    depth: 0,
    overrideAccess: true,
  })) as unknown as WorkflowEditionDoc
  return doc
}

/**
 * Immutable assessment gate for `approved` (and `compiled`): the newest
 * assessment for the edition must be passed and its inputHash must match the
 * live edition content, so approval on stale evidence is impossible.
 */
const verifiedAssessmentState = async (
  payload: Payload,
  doc: WorkflowEditionDoc,
): Promise<"passed"> => {
  const found = await payload.find({
    collection: "quality-assessments",
    where: { edition: { equals: doc.id } },
    sort: "-createdAt",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const assessment = found.docs[0]
  if (assessment === undefined) {
    throw fail("EDITION_WORKFLOW_ASSESSMENT_REQUIRED", `edition ${doc.id}`)
  }
  if (assessment.state !== "passed") {
    throw fail("EDITION_WORKFLOW_ASSESSMENT_NOT_PASSED", `edition ${doc.id}`)
  }
  const liveHash = hashEditionContent(snapshotOf(doc))
  if (assessment.inputHash !== liveHash) {
    throw fail("EDITION_WORKFLOW_STALE_ASSESSMENT", `edition ${doc.id}`)
  }
  return "passed"
}

export type TransitionOptions = {
  readonly editionId: number
  readonly target: ContentEditionState
  readonly user: unknown
  readonly compiledReleaseId?: string
  readonly reason?: string
}

export async function transitionEdition(
  payload: Payload,
  options: TransitionOptions,
): Promise<ContentEditionState> {
  const actor = actorOf(options.user)
  if (actor === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no valid user actor")
  }
  const doc = await loadEdition(payload, options.editionId)
  const aggregate = aggregateOf(doc)

  const needsAssessment = options.target === "approved" || options.target === "compiled"
  const qualityAssessmentState = needsAssessment
    ? await verifiedAssessmentState(payload, doc)
    : null

  if (options.target === "compiled" && stringField(options.compiledReleaseId) === null) {
    throw fail("EDITION_WORKFLOW_RELEASE_REQUIRED", "compile intent requires artifact metadata")
  }
  if (options.target === "published" && stringField(doc.compiledRelease) === null) {
    throw fail("EDITION_WORKFLOW_NOT_COMPILED", "publish intent requires a compiled release")
  }

  const transitioned = transitionContentEdition(aggregate, options.target, {
    actor,
    clock: systemClock,
    expectedRevision: aggregate.revision,
    qualityAssessmentState,
  })
  if (!transitioned.ok) {
    throw new EditionWorkflowError(transitioned.error.code, transitioned.error.message)
  }

  const serializedActor = serializedActorOf(options.user)
  if (serializedActor === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no serializable actor")
  }
  const entry: AuditEntry = {
    action: `content-edition.${aggregate.state}.${options.target}`,
    actor: serializedActor,
    at: systemClock.now().value,
    from: aggregate.state,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    tenantId: numberField(doc.tenant) ?? -1,
    to: options.target,
  }
  const existingAudit = Array.isArray(doc.auditLog) ? doc.auditLog : []
  const updated = await payload.update({
    collection: "content-editions",
    where: {
      and: [
        { id: { equals: options.editionId } },
        { workflowRevision: { equals: aggregate.revision } },
      ],
    },
    data: {
      auditLog: [...existingAudit, entry],
      ...(options.target === "compiled" ? { compiledRelease: options.compiledReleaseId } : {}),
      workflowRevision: aggregate.revision + 1,
      workflowStatus: options.target,
    },
    overrideAccess: true,
    depth: 0,
  })
  if (updated.docs.length === 0) {
    throw fail("EDITION_WORKFLOW_REVISION_CONFLICT", `edition ${options.editionId}`)
  }
  return options.target
}

/**
 * Version supersession: editing published content opens a new draft version.
 * Requires an editor actor and a published source (domain guard), resets the
 * workflow revision, and records the audit entry.
 */
export async function createDraftFromPublished(
  payload: Payload,
  editionId: number,
  user: unknown,
  reason?: string,
): Promise<void> {
  const actor = actorOf(user)
  if (actor === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no valid user actor")
  }
  const doc = await loadEdition(payload, editionId)
  const aggregate = aggregateOf(doc)
  const drafted = createDraftEditionFromPublished(aggregate, aggregate.id, {
    actor,
    clock: systemClock,
    expectedRevision: aggregate.revision,
  })
  if (!drafted.ok) {
    throw new EditionWorkflowError(drafted.error.code, drafted.error.message)
  }
  const serializedActor = serializedActorOf(user)
  if (serializedActor === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no serializable actor")
  }
  const entry: AuditEntry = {
    action: "content-edition.published.draft",
    actor: serializedActor,
    at: systemClock.now().value,
    from: "published",
    ...(reason === undefined ? {} : { reason }),
    tenantId: numberField(doc.tenant) ?? -1,
    to: "draft",
  }
  const existingAudit = Array.isArray(doc.auditLog) ? doc.auditLog : []
  await payload.update({
    collection: "content-editions",
    id: editionId,
    draft: true,
    data: {
      auditLog: [...existingAudit, entry],
      compiledRelease: null,
      workflowRevision: 0,
      workflowStatus: "draft",
    },
    overrideAccess: true,
    depth: 0,
  })
}

export type RecordAssessmentInput = {
  readonly editionId: number
  readonly inputHash: string
  readonly issues: readonly { readonly code: string; readonly severity: string }[]
  readonly modelId: string
  readonly promptVersion: string
  readonly provider: string
  readonly state: "error" | "failed" | "passed"
  readonly thresholdsHash: string
}

/**
 * Write-once quality evidence. The CMS records the assessment produced by
 * the content-service; it never computes quality itself, and manual
 * overrides do not exist in P0.
 */
export async function recordAssessment(
  payload: Payload,
  input: RecordAssessmentInput,
): Promise<number> {
  const doc = await loadEdition(payload, input.editionId)
  const created = await payload.create({
    collection: "quality-assessments",
    data: {
      edition: input.editionId,
      inputHash: input.inputHash,
      issues: input.issues.map((issue) => ({ ...issue })),
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      provider: input.provider,
      site: numberField(doc.site) ?? -1,
      state: input.state,
      tenant: numberField(doc.tenant) ?? -1,
      thresholdsHash: input.thresholdsHash,
    },
    overrideAccess: true,
    depth: 0,
  })
  return created.id
}

export const currentEditionInputHash = (doc: WorkflowEditionDoc): string =>
  hashEditionContent(snapshotOf(doc))

export const loadWorkflowEdition = loadEdition

export type { WorkflowEditionDoc, AuditEntry }

import {
  type AuditActor,
  type Clock,
  type ContentEdition,
  type ContentEditionState,
  createDraftEditionFromPublished,
  createUserAuditActor,
  parseContentId,
  parseEditionId,
  parseInstant,
  parseSiteId,
  parseTenantId,
  parseUserId,
  transitionContentEdition,
} from "@geo/domain"
import type { Payload } from "payload"

import { resolveSessionClaims, type SessionClaims } from "../access/session"
import {
  appendOutboxEvent,
  OUTBOX_EVENT,
  runOutboxScopedTransaction,
  type TransactionScope,
} from "../outbox/outbox"
import { type EditionContentSnapshot, hashEditionContent } from "./edition-input-hash"
import { reserveEditionUrl } from "./edition-url-lifecycle"

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

export type WorkflowEditionDoc = {
  readonly id: number
  readonly content: unknown
  readonly site: unknown
  readonly tenant: unknown
  readonly createdAt?: unknown
  readonly contentModifiedAt?: unknown
  readonly updatedAt?: unknown
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

export const numberFieldOf = (value: unknown): number | null =>
  typeof value === "number" ? value : null

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

export const parseWorkflowStatus = (value: unknown): ContentEditionState => {
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

export type AuditEntry = {
  readonly action: string
  readonly actor: SerializedAuditActor
  readonly at: string
  readonly detail?: Record<string, unknown>
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

export const serializedActorOf = (user: unknown): SerializedAuditActor | null => {
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

/**
 * Zero-trust tenant guard: every service-level mutation re-checks that the
 * actor's session tenant matches the edition's tenant. Super-admin is the
 * only cross-tenant role.
 */
export const assertEditionTenantScope = (user: unknown, doc: WorkflowEditionDoc): SessionClaims => {
  const claims = resolveSessionClaims(user)
  if (claims === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no valid claims")
  }
  if (claims.role === "super-admin") {
    return claims
  }
  const editionTenant = numberFieldOf(doc.tenant)
  if (
    claims.tenantId === null ||
    editionTenant === null ||
    String(claims.tenantId) !== String(editionTenant)
  ) {
    throw fail(
      "EDITION_WORKFLOW_TENANT_MISMATCH",
      `actor tenant ${String(claims.tenantId)} edition tenant ${String(editionTenant)}`,
    )
  }
  return claims
}

/** Service-identity guard for generated-content integration operations. */
export const requireServiceIdentity = (user: unknown): SessionClaims => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw fail(
      "EDITION_WORKFLOW_SERVICE_REQUIRED",
      "operation requires the content-service identity",
    )
  }
  return claims
}

const aggregateOf = (doc: WorkflowEditionDoc): ContentEdition => {
  const editionId = parseEditionId(String(doc.id))
  const contentId = parseContentId(String(numberFieldOf(doc.content) ?? -1))
  const siteId = parseSiteId(String(numberFieldOf(doc.site) ?? -1))
  const tenantId = parseTenantId(String(numberFieldOf(doc.tenant) ?? -1))
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
    revision: numberFieldOf(doc.workflowRevision) ?? 0,
    state: parseWorkflowStatus(doc.workflowStatus),
    version: 1,
  })
}

export const editionContentSnapshotOf = (doc: WorkflowEditionDoc): EditionContentSnapshot => ({
  body: doc.body,
  primaryTopic: doc.primaryTopic,
  secondaryTopics: doc.secondaryTopics,
  summary: doc.summary,
  title: doc.title,
})

const isNotFoundError = (error: unknown): boolean => (error as { status?: unknown }).status === 404

export const loadWorkflowEdition = async (
  payload: Payload,
  editionId: number,
  req: TransactionScope = {},
  draft = false,
): Promise<WorkflowEditionDoc> => {
  try {
    return (await payload.findByID({
      collection: "content-editions",
      draft,
      id: editionId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as WorkflowEditionDoc
  } catch (error) {
    if (isNotFoundError(error)) {
      throw fail("EDITION_WORKFLOW_NOT_FOUND", `edition ${editionId}`)
    }
    throw error
  }
}

export type TransitionOptions = {
  readonly editionId: number
  readonly target: ContentEditionState
  readonly user: unknown
  readonly compiledReleaseId?: string
  readonly decisionId?: string
  readonly expectedRevision?: number
  readonly idempotencyKeyHash?: string
  readonly operationId?: string
  readonly reason?: string
  readonly requestId?: string
}

const transitionEditionInScope = async (
  payload: Payload,
  options: TransitionOptions,
  req: TransactionScope,
): Promise<ContentEditionState> => {
  const actor = actorOf(options.user)
  if (actor === null) {
    throw fail("EDITION_WORKFLOW_ACTOR_INVALID", "session has no valid user actor")
  }
  const doc = await loadWorkflowEdition(payload, options.editionId, req, true)
  assertEditionTenantScope(options.user, doc)
  const aggregate = aggregateOf(doc)
  if (options.expectedRevision !== undefined && options.expectedRevision !== aggregate.revision) {
    throw fail("EDITION_WORKFLOW_REVISION_CONFLICT", `edition ${options.editionId}`)
  }
  const reason = stringField(options.reason)?.trim()
  /*
   * Free operator flow: transitions between visible lanes carry no role or
   * evidence gates anymore (audit entries record the actor). Quality
   * evaluation remains a pipeline capability, not a publishing gate.
   */
  const qualityAssessmentState = null
  if (options.target === "approved") {
    await reserveEditionUrl(payload, doc, req)
  }

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
    ...(options.decisionId === undefined &&
    options.idempotencyKeyHash === undefined &&
    options.requestId === undefined
      ? {}
      : {
          detail: {
            ...(options.decisionId === undefined ? {} : { decisionId: options.decisionId }),
            ...(options.idempotencyKeyHash === undefined
              ? {}
              : { idempotencyKeyHash: options.idempotencyKeyHash }),
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
          },
        }),
    from: aggregate.state,
    ...(reason === undefined || reason.length === 0 ? {} : { reason }),
    tenantId: numberFieldOf(doc.tenant) ?? -1,
    to: options.target,
  }
  const existingAudit = Array.isArray(doc.auditLog) ? doc.auditLog : []
  const data = {
    auditLog: [...existingAudit, entry],
    ...(options.target === "compiled" && options.compiledReleaseId !== undefined
      ? { compiledRelease: options.compiledReleaseId }
      : options.target === "published" || options.target === "archived"
        ? { compiledRelease: stringField(doc.compiledRelease) ?? null }
        : {}),
    workflowRevision: aggregate.revision + 1,
    workflowStatus: options.target,
  }
  // Published and archived are externally visible terminal states. Persist them
  // to the live document rather than only the Payload draft version, otherwise
  // a later archive action appears in the editor but API readers still see published.
  const updated = await payload.update({
    collection: "content-editions",
    data,
    depth: 0,
    draft: options.target === "published" || options.target === "archived" ? false : true,
    overrideAccess: true,
    req,
    // Draft workflow states are guarded by the draft revision. Publishing and
    // archiving write the live document, whose persisted revision may lag the
    // current draft version; the transaction and prior draft read remain the
    // concurrency boundary for those terminal writes.
    where:
      options.target === "published" || options.target === "archived"
        ? { id: { equals: options.editionId } }
        : {
            and: [
              { id: { equals: options.editionId } },
              { workflowRevision: { equals: aggregate.revision } },
            ],
          },
  })
  const persisted = (updated.docs[0] as unknown as WorkflowEditionDoc | undefined) ?? null
  if (
    updated.docs.length !== 1 ||
    persisted === null ||
    parseWorkflowStatus(persisted.workflowStatus) !== options.target ||
    numberFieldOf(persisted.workflowRevision) !== aggregate.revision + 1
  ) {
    throw fail("EDITION_WORKFLOW_REVISION_CONFLICT", `edition ${options.editionId}`)
  }
  await appendOutboxEvent(
    payload,
    {
      aggregateId: options.editionId,
      eventPayload: {
        from: aggregate.state,
        to: options.target,
        workflowRevision: aggregate.revision + 1,
        ...(options.target === "compiled" && options.compiledReleaseId !== undefined
          ? { releaseId: options.compiledReleaseId }
          : {}),
        ...(reason === undefined || reason.length === 0 ? {} : { reason }),
        ...(options.decisionId === undefined ? {} : { decisionId: options.decisionId }),
        ...(options.requestId === undefined ? {} : { correlationId: options.requestId }),
      },
      tenantId: numberFieldOf(doc.tenant) ?? -1,
      type: OUTBOX_EVENT.EDITION_TRANSITIONED,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    },
    req,
  )
  return options.target
}

export async function transitionEdition(
  payload: Payload,
  options: TransitionOptions,
): Promise<ContentEditionState> {
  return runOutboxScopedTransaction(payload, (req) =>
    transitionEditionInScope(payload, options, req),
  )
}

export const transitionEditionWithinTransaction = transitionEditionInScope

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
  await runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, editionId, req)
    assertEditionTenantScope(user, doc)
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
      tenantId: numberFieldOf(doc.tenant) ?? -1,
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
      req,
    })
    await appendOutboxEvent(
      payload,
      {
        aggregateId: editionId,
        eventPayload: { to: "draft", version: aggregate.version + 1 },
        tenantId: numberFieldOf(doc.tenant) ?? -1,
        type: OUTBOX_EVENT.EDITION_TRANSITIONED,
      },
      req,
    )
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
  readonly operationId?: string
  readonly requestId?: string
  readonly user?: unknown
}

/**
 * Write-once quality evidence. The CMS records the assessment produced by
 * the content-service; it never computes quality itself, and manual
 * overrides do not exist in P0. When called through the integration surface
 * the caller must be the tenant-scoped content-service identity.
 */
export async function recordAssessment(
  payload: Payload,
  input: RecordAssessmentInput,
): Promise<number> {
  if (input.user !== undefined) {
    requireServiceIdentity(input.user)
  }
  return runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, input.editionId, req, true)
    if (input.user !== undefined) {
      assertEditionTenantScope(input.user, doc)
    }
    const created = await payload.create({
      collection: "quality-assessments",
      data: {
        edition: input.editionId,
        inputHash: input.inputHash,
        issues: input.issues.map((issue) => ({ ...issue })),
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        provider: input.provider,
        site: numberFieldOf(doc.site) ?? -1,
        state: input.state,
        tenant: numberFieldOf(doc.tenant) ?? -1,
        thresholdsHash: input.thresholdsHash,
      },
      overrideAccess: true,
      depth: 0,
      req,
    })
    await appendOutboxEvent(
      payload,
      {
        aggregateId: input.editionId,
        eventPayload: {
          assessmentId: created.id,
          inputHash: input.inputHash,
          state: input.state,
        },
        tenantId: numberFieldOf(doc.tenant) ?? -1,
        type: OUTBOX_EVENT.ASSESSMENT_RECORDED,
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      },
      req,
    )
    return created.id
  })
}

export const currentEditionInputHash = (doc: WorkflowEditionDoc): string =>
  hashEditionContent(editionContentSnapshotOf(doc))

export const systemClockOf = (): { readonly value: string } => systemClock.now()

export type { TransactionScope }

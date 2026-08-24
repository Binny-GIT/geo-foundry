import { createHash } from "node:crypto"
import {
  createServiceAuditActor,
  parseInstant,
  parseOperationId,
  parseSha256Hash,
  parseSiteId,
  parseTenantId,
  transitionOperation,
  type Clock,
  type Operation,
  type OperationState,
  type Ownership,
  type ServiceAuditActor,
} from "@geo/domain"
import type { Payload } from "payload"

import type { SessionClaims } from "../access/session"
import { runOutboxScopedTransaction, type TransactionScope } from "../outbox/outbox"
import { canonicalize } from "./edition-input-hash"
import {
  assertEditionTenantScope,
  EditionWorkflowError,
  loadWorkflowEdition,
  parseWorkflowStatus,
  requireServiceIdentity,
  serializedActorOf,
  type SerializedAuditActor,
} from "./edition-workflow"

export class OperationsLedgerError extends Error {
  override readonly name = "OperationsLedgerError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail: string): OperationsLedgerError =>
  new OperationsLedgerError(code, detail)

export const OPERATION_TYPE = ["generate", "evaluate", "publish", "rollback"] as const
export type OperationType = (typeof OPERATION_TYPE)[number]

export const OPERATION_STAGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export type LedgerAuditEntry = {
  readonly action: string
  readonly actor: ReturnType<typeof serializedActorOf>
  readonly at: string
  readonly detail?: Record<string, unknown>
  readonly reason?: string
}

type LedgerOperationDoc = {
  readonly id: number
  readonly operationId: string
  readonly tenant: unknown
  readonly site: unknown
  readonly operationType: unknown
  readonly endpoint: unknown
  readonly state: unknown
  readonly attempt: unknown
  readonly revision: unknown
  readonly idempotencyKeyHash: unknown
  readonly currentStage: unknown
  readonly lastStageAt: unknown
  readonly targetIds: unknown
  readonly requestPayload: unknown
  readonly result: unknown
  readonly error: unknown
  readonly auditLog: unknown
}

type IdempotencyRecordDoc = {
  readonly id: number
  readonly uniqueKey: string
  readonly tenant: unknown
  readonly endpoint: string
  readonly idempotencyKey: string
  readonly requestHash: string
  readonly operationId: string
  readonly replayCount: unknown
}

const numberField = (value: unknown): number | null => (typeof value === "number" ? value : null)

const parseState = (value: unknown): OperationState => {
  switch (value) {
    case "cancelled":
    case "failed":
    case "queued":
    case "running":
    case "succeeded":
      return value
    default:
      throw fail("OPERATION_STATE_INVALID", String(value))
  }
}

const parseOperationType = (value: unknown): OperationType => {
  switch (value) {
    case "evaluate":
    case "generate":
    case "publish":
    case "rollback":
      return value
    default:
      throw fail("OPERATIONS_INPUT_INVALID", String(value))
  }
}

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === "23505") {
    return true
  }
  if (typeof candidate.message !== "string") {
    return false
  }
  return (
    candidate.message.includes("duplicate key value violates unique constraint") ||
    candidate.message.includes("field is invalid: uniqueKey")
  )
}

export const operationUniqueKeyOf = (tenantId: number, endpoint: string, key: string): string =>
  createHash("sha256").update(`${tenantId}\n${endpoint}\n${key}`).digest("hex")

export const operationRequestHashOf = (requestPayload: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(requestPayload)))
    .digest("hex")

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

const ledgerClock: Clock = {
  now: () => {
    const instant = parseInstant(new Date().toISOString())
    if (!instant.ok) {
      throw fail("OPERATION_CLOCK_INVALID", "wall clock produced an unparseable instant")
    }
    return instant.value
  },
}

const serviceActorOf = (operationId: string, tenantId: number): ServiceAuditActor | null => {
  const parsedOperation = parseOperationId(operationId)
  const parsedTenant = parseTenantId(String(tenantId))
  if (!parsedOperation.ok || !parsedTenant.ok) {
    return null
  }
  return createServiceAuditActor({
    operationId: parsedOperation.value,
    tenantId: parsedTenant.value,
  })
}

const loadRecordByUniqueKey = async (
  payload: Payload,
  uniqueKey: string,
  req: TransactionScope = {},
): Promise<IdempotencyRecordDoc | null> => {
  const found = await payload.find({
    collection: "idempotency-records",
    where: { uniqueKey: { equals: uniqueKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return (found.docs[0] as unknown as IdempotencyRecordDoc) ?? null
}

const loadOperationByPublicId = async (
  payload: Payload,
  operationId: string,
  req: TransactionScope = {},
): Promise<LedgerOperationDoc> => {
  const found = await payload.find({
    collection: "operations",
    where: { operationId: { equals: operationId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const doc = found.docs[0] as unknown as LedgerOperationDoc | undefined
  if (doc === undefined) {
    throw fail("OPERATION_NOT_FOUND", operationId)
  }
  return doc
}

const assertTenantScope = (claims: SessionClaims, doc: LedgerOperationDoc): number => {
  if (claims.role === "super-admin") {
    return numberField(doc.tenant) ?? -1
  }
  const docTenant = numberField(doc.tenant)
  if (
    claims.tenantId === null ||
    docTenant === null ||
    String(claims.tenantId) !== String(docTenant)
  ) {
    throw fail(
      "OPERATION_TENANT_MISMATCH",
      `actor tenant ${String(claims.tenantId)} operation tenant ${String(docTenant)}`,
    )
  }
  return docTenant
}

const aggregateOf = (doc: LedgerOperationDoc): Operation => {
  const parsedId = parseOperationId(doc.operationId)
  const parsedKeyHash = parseSha256Hash(String(doc.idempotencyKeyHash ?? ""))
  if (!parsedId.ok || !parsedKeyHash.ok) {
    throw fail("OPERATION_STATE_INVALID", `operation ${doc.operationId} identity`)
  }
  const tenantId = parseTenantId(String(numberField(doc.tenant) ?? -1))
  if (!tenantId.ok) {
    throw fail("OPERATION_STATE_INVALID", `operation ${doc.operationId} tenant`)
  }
  const siteNumber = numberField(doc.site)
  const ownership: Ownership = (() => {
    if (siteNumber === null) {
      return Object.freeze({ scope: "tenant", tenantId: tenantId.value })
    }
    const siteId = parseSiteId(String(siteNumber))
    if (!siteId.ok) {
      throw fail("OPERATION_STATE_INVALID", `operation ${doc.operationId} site`)
    }
    return Object.freeze({ scope: "site", siteId: siteId.value, tenantId: tenantId.value })
  })()
  return Object.freeze({
    attempt: numberField(doc.attempt) ?? 1,
    audit: [],
    id: parsedId.value,
    idempotencyKeyHash: parsedKeyHash.value,
    ownership,
    revision: numberField(doc.revision) ?? 0,
    retryOf: null,
    state: parseState(doc.state),
  })
}

const auditOf = (doc: LedgerOperationDoc): LedgerAuditEntry[] =>
  Array.isArray(doc.auditLog) ? (doc.auditLog as LedgerAuditEntry[]) : []

export type SubmitOperationInput = {
  readonly endpoint: string
  readonly idempotencyKey: string
  readonly operationType: OperationType
  readonly requestPayload: unknown
  readonly siteId?: number
  readonly targetIds?: Record<string, number>
  readonly user: unknown
}

export type OperationSnapshot = {
  readonly requestPayload: Record<string, unknown>
  readonly attempt: number
  readonly currentStage: string | null
  readonly endpoint: string
  readonly error: Record<string, unknown> | null
  readonly operationId: string
  readonly operationType: OperationType
  readonly result: Record<string, unknown> | null
  readonly state: OperationState
  readonly tenantId: number
}

const snapshotOf = (doc: LedgerOperationDoc): OperationSnapshot => ({
  attempt: numberField(doc.attempt) ?? 1,
  currentStage:
    typeof doc.currentStage === "string" && doc.currentStage.length > 0 ? doc.currentStage : null,
  endpoint: String(doc.endpoint),
  error: (doc.error as Record<string, unknown> | null) ?? null,
  operationId: doc.operationId,
  operationType: parseOperationType(doc.operationType),
  requestPayload: (doc.requestPayload as Record<string, unknown> | null) ?? {},
  result: (doc.result as Record<string, unknown> | null) ?? null,
  state: parseState(doc.state),
  tenantId: numberField(doc.tenant) ?? -1,
})

export type SubmitOperationOutcome = {
  readonly created: boolean
  readonly operation: OperationSnapshot
}

const replayOutcome = async (
  payload: Payload,
  record: IdempotencyRecordDoc,
): Promise<SubmitOperationOutcome> => {
  await payload.update({
    collection: "idempotency-records",
    id: record.id,
    data: { replayCount: (numberField(record.replayCount) ?? 0) + 1 },
    overrideAccess: true,
    depth: 0,
  })
  const doc = await loadOperationByPublicId(payload, record.operationId)
  return { created: false, operation: snapshotOf(doc) }
}

/**
 * Create-or-replay idempotent submit. The unique `uniqueKey` index on
 * (tenant, endpoint, idempotencyKey) arbitrates concurrent duplicates: the
 * loser rolls back, re-reads, and replays the winner; a different request
 * fingerprint under the same key is rejected with 409 semantics.
 */
export async function submitOperation(
  payload: Payload,
  input: SubmitOperationInput,
): Promise<SubmitOperationOutcome> {
  const claims = requireServiceIdentity(input.user)
  if (claims.tenantId === null) {
    throw fail("OPERATIONS_INPUT_INVALID", "service identity must be tenant-bound")
  }
  const tenantId = Number(claims.tenantId)
  const requestHash = operationRequestHashOf(input.requestPayload)
  const uniqueKey = operationUniqueKeyOf(tenantId, input.endpoint, input.idempotencyKey)

  const existing = await loadRecordByUniqueKey(payload, uniqueKey)
  if (existing !== null) {
    if (existing.requestHash !== requestHash) {
      throw fail(
        "IDEMPOTENCY_KEY_REUSED",
        `key ${input.idempotencyKey} already bound to a different request body`,
      )
    }
    return replayOutcome(payload, existing)
  }

  const actor = serializedActorOf(input.user)
  if (actor === null) {
    throw fail("OPERATIONS_INPUT_INVALID", "service identity is not serializable")
  }
  const operationId = crypto.randomUUID()
  const entry: LedgerAuditEntry = {
    action: "operation.created",
    actor,
    at: ledgerClock.now().value,
    detail: { endpoint: input.endpoint, requestHash },
  }

  try {
    return await runOutboxScopedTransaction(payload, async (req) => {
      const raced = await loadRecordByUniqueKey(payload, uniqueKey, req)
      if (raced !== null) {
        if (raced.requestHash !== requestHash) {
          throw fail(
            "IDEMPOTENCY_KEY_REUSED",
            `key ${input.idempotencyKey} already bound to a different request body`,
          )
        }
        return {
          created: false,
          operation: snapshotOf(await loadOperationByPublicId(payload, raced.operationId, req)),
        }
      }
      await payload.create({
        collection: "operations",
        data: {
          auditLog: [entry],
          attempt: 1,
          endpoint: input.endpoint,
          error: null,
          idempotencyKeyHash: sha256Text(input.idempotencyKey),
          operationId,
          operationType: input.operationType,
          requestPayload: input.requestPayload as Record<string, unknown>,
          revision: 0,
          result: null,
          state: "queued",
          ...(input.siteId === undefined ? {} : { site: input.siteId }),
          targetIds: input.targetIds ?? {},
          tenant: tenantId,
        },
        overrideAccess: true,
        depth: 0,
        req,
      })
      await payload.create({
        collection: "idempotency-records",
        data: {
          endpoint: input.endpoint,
          idempotencyKey: input.idempotencyKey,
          operationId,
          requestHash,
          tenant: tenantId,
          uniqueKey,
        },
        overrideAccess: true,
        depth: 0,
        req,
      })
      return {
        created: true,
        operation: {
          attempt: 1,
          currentStage: null,
          endpoint: input.endpoint,
          error: null,
          operationId,
          operationType: input.operationType,
          requestPayload: input.requestPayload as Record<string, unknown>,
          result: null,
          state: "queued",
          tenantId,
        },
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await loadRecordByUniqueKey(payload, uniqueKey)
      if (winner === null) {
        throw error
      }
      if (winner.requestHash !== requestHash) {
        throw fail(
          "IDEMPOTENCY_KEY_REUSED",
          `key ${input.idempotencyKey} already bound to a different request body`,
        )
      }
      return replayOutcome(payload, winner)
    }
    throw error
  }
}

export async function getOperation(
  payload: Payload,
  operationId: string,
  user: unknown,
): Promise<OperationSnapshot> {
  const claims = requireServiceIdentity(user)
  const doc = await loadOperationByPublicId(payload, operationId)
  assertTenantScope(claims, doc)
  return snapshotOf(doc)
}

export type PublishOperationCreator = {
  readonly actor: SerializedAuditActor
  readonly operationType: OperationType
}

/**
 * Recovers the identity that originally authorized a publish operation. The
 * worker completes the publish job under the content-service identity, but
 * the edition may only advance to published under the actor who actually
 * requested it - never the service actor that reports the verified receipt.
 */
export async function loadPublishOperationCreator(
  payload: Payload,
  operationId: string,
  req: TransactionScope = {},
): Promise<PublishOperationCreator> {
  const doc = await loadOperationByPublicId(payload, operationId, req)
  const created = auditOf(doc).find((entry) => entry.action === "operation.created")
  if (created === undefined || created.actor === null || created.actor === undefined) {
    throw fail("OPERATION_STATE_INVALID", `operation ${operationId} has no creator actor`)
  }
  return { actor: created.actor, operationType: parseOperationType(doc.operationType) }
}

export type SubmitEditionPublishInput = {
  readonly editionId: number
  readonly user: unknown
}

export type SubmitEditionPublishOutcome = {
  readonly created: boolean
  readonly operationId: string
  readonly releaseId: string
  readonly state: OperationState
}

/**
 * Publisher-authorized publish intent for one compiled edition. The
 * idempotency key is derived from the exact compiled release, so re-clicking
 * the same publish action replays the same operation instead of creating a
 * new one, and a later compile of a new release opens a genuinely new key.
 * Creation alone never mutates workflow state; the release registry advances
 * the edition only after a real, CAS-verified artifact upload is recorded.
 */
export async function submitEditionPublishOperation(
  payload: Payload,
  input: SubmitEditionPublishInput,
): Promise<SubmitEditionPublishOutcome> {
  return runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, input.editionId, req, true)
    const claims = assertEditionTenantScope(input.user, doc)
    if (claims.role !== "publisher") {
      throw new EditionWorkflowError(
        "EDITION_WORKFLOW_PUBLISHER_REQUIRED",
        `role ${claims.role} cannot submit a publish operation`,
      )
    }
    const status = parseWorkflowStatus(doc.workflowStatus)
    const releaseId =
      typeof doc.compiledRelease === "string" && doc.compiledRelease.length > 0
        ? doc.compiledRelease
        : null
    if (status !== "compiled" || releaseId === null) {
      throw new EditionWorkflowError(
        "EDITION_WORKFLOW_NOT_COMPILED",
        `edition ${input.editionId} is ${status}`,
      )
    }

    const tenantId = numberField(doc.tenant) ?? -1
    const siteId = numberField(doc.site)
    const endpoint = `/editions/${input.editionId}/publish`
    const idempotencyKey = `publish-edition-${input.editionId}-${releaseId}`
    const uniqueKey = operationUniqueKeyOf(tenantId, endpoint, idempotencyKey)
    const requestPayload = { body: { editionId: input.editionId } }
    const requestHash = operationRequestHashOf(requestPayload)

    const existing = await loadRecordByUniqueKey(payload, uniqueKey, req)
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw fail(
          "IDEMPOTENCY_KEY_REUSED",
          `edition ${input.editionId} publish key already bound to a different request`,
        )
      }
      const operation = await loadOperationByPublicId(payload, existing.operationId, req)
      return {
        created: false,
        operationId: existing.operationId,
        releaseId,
        state: parseState(operation.state),
      }
    }

    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw new EditionWorkflowError(
        "EDITION_WORKFLOW_ACTOR_INVALID",
        "session has no serializable actor",
      )
    }
    const operationId = crypto.randomUUID()
    const entry: LedgerAuditEntry = {
      action: "operation.created",
      actor,
      at: ledgerClock.now().value,
      detail: { endpoint, requestHash },
    }
    await payload.create({
      collection: "operations",
      data: {
        auditLog: [entry],
        attempt: 1,
        endpoint,
        error: null,
        idempotencyKeyHash: sha256Text(idempotencyKey),
        operationId,
        operationType: "publish",
        requestPayload,
        revision: 0,
        result: null,
        ...(siteId === null ? {} : { site: siteId }),
        state: "queued",
        targetIds: { editionId: input.editionId },
        tenant: tenantId,
      },
      overrideAccess: true,
      depth: 0,
      req,
    })
    await payload.create({
      collection: "idempotency-records",
      data: {
        endpoint,
        idempotencyKey,
        operationId,
        requestHash,
        tenant: tenantId,
        uniqueKey,
      },
      overrideAccess: true,
      depth: 0,
      req,
    })
    return { created: true, operationId, releaseId, state: "queued" }
  })
}

export type StageInput = {
  readonly attempt: number
  readonly operationId: string
  readonly stage: string
  readonly user: unknown
}

const assertStage = (stage: string): void => {
  if (!OPERATION_STAGE_PATTERN.test(stage)) {
    throw fail("OPERATION_STAGE_INVALID", stage)
  }
}

const appendAudit = async (
  payload: Payload,
  doc: LedgerOperationDoc,
  entry: LedgerAuditEntry,
  data: Record<string, unknown>,
  req: TransactionScope,
): Promise<void> => {
  const aggregate = aggregateOf(doc)
  const updated = await payload.update({
    collection: "operations",
    where: {
      and: [{ id: { equals: doc.id } }, { revision: { equals: aggregate.revision } }],
    },
    data: {
      auditLog: [...auditOf(doc), entry],
      revision: aggregate.revision + 1,
      ...data,
    },
    overrideAccess: true,
    depth: 0,
    req,
  })
  if (updated.docs.length === 0) {
    throw fail("OPERATION_REVISION_CONFLICT", doc.operationId)
  }
}

const loadForStage = async (
  payload: Payload,
  input: { readonly attempt: number; readonly operationId: string; readonly user: unknown },
  req: TransactionScope = {},
): Promise<{ claims: SessionClaims; doc: LedgerOperationDoc }> => {
  const claims = requireServiceIdentity(input.user)
  const doc = await loadOperationByPublicId(payload, input.operationId, req)
  assertTenantScope(claims, doc)
  const currentAttempt = numberField(doc.attempt) ?? 1
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt !== currentAttempt) {
    throw fail(
      "OPERATION_ATTEMPT_STALE",
      `reported attempt ${input.attempt} but operation is at attempt ${currentAttempt}`,
    )
  }
  return { claims, doc }
}

export async function startOperationStage(
  payload: Payload,
  input: StageInput,
): Promise<OperationSnapshot> {
  assertStage(input.stage)
  return runOutboxScopedTransaction(payload, async (req) => {
    const { doc } = await loadForStage(payload, input, req)
    const aggregate = aggregateOf(doc)
    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw fail("OPERATIONS_INPUT_INVALID", "service identity is not serializable")
    }
    const entry: LedgerAuditEntry = {
      action: `operation.stage.started:${input.stage}`,
      actor,
      at: ledgerClock.now().value,
      detail: { attempt: input.attempt, stage: input.stage },
    }
    const transitionActor = serviceActorOf(doc.operationId, numberField(doc.tenant) ?? -1)
    if (transitionActor === null) {
      throw fail("OPERATION_STATE_INVALID", "operation identity is not resolvable")
    }
    if (aggregate.state === "queued") {
      const transitioned = transitionOperation(aggregate, "running", {
        actor: transitionActor,
        clock: ledgerClock,
        expectedRevision: aggregate.revision,
      })
      if (!transitioned.ok) {
        throw new OperationsLedgerError(transitioned.error.code, transitioned.error.message)
      }
      await appendAudit(
        payload,
        doc,
        entry,
        {
          currentStage: input.stage,
          lastStageAt: new Date().toISOString(),
          state: "running",
        },
        req,
      )
    } else if (aggregate.state === "running") {
      await appendAudit(
        payload,
        doc,
        entry,
        { currentStage: input.stage, lastStageAt: new Date().toISOString() },
        req,
      )
    } else {
      throw fail(
        "OPERATION_TRANSITION_NOT_ALLOWED",
        `operation ${input.operationId} is ${aggregate.state} and cannot start a stage`,
      )
    }
    return snapshotOf(await loadOperationByPublicId(payload, input.operationId, req))
  })
}

export type CompleteStageInput = {
  readonly attempt: number
  readonly error?: Record<string, unknown>
  readonly operationId: string
  readonly outcome: "failed" | "succeeded"
  readonly result?: Record<string, unknown>
  readonly stage: string
  readonly user: unknown
}

export async function completeOperationStage(
  payload: Payload,
  input: CompleteStageInput,
): Promise<OperationSnapshot> {
  assertStage(input.stage)
  if (input.outcome === "succeeded" && input.result === undefined) {
    throw fail("OPERATIONS_INPUT_INVALID", "succeeded stages require a result envelope")
  }
  if (input.outcome === "failed" && input.error === undefined) {
    throw fail("OPERATIONS_INPUT_INVALID", "failed stages require an error envelope")
  }
  return runOutboxScopedTransaction(payload, async (req) => {
    const { doc } = await loadForStage(payload, input, req)
    const aggregate = aggregateOf(doc)
    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw fail("OPERATIONS_INPUT_INVALID", "service identity is not serializable")
    }
    const entry: LedgerAuditEntry = {
      action: `operation.stage.completed:${input.stage}`,
      actor,
      at: ledgerClock.now().value,
      detail: {
        attempt: input.attempt,
        outcome: input.outcome,
        stage: input.stage,
      },
    }
    const transitionActor = serviceActorOf(doc.operationId, numberField(doc.tenant) ?? -1)
    if (transitionActor === null) {
      throw fail("OPERATION_STATE_INVALID", "operation identity is not resolvable")
    }
    const transitioned = transitionOperation(aggregate, input.outcome, {
      actor: transitionActor,
      clock: ledgerClock,
      expectedRevision: aggregate.revision,
    })
    if (!transitioned.ok) {
      throw new OperationsLedgerError(transitioned.error.code, transitioned.error.message)
    }
    await appendAudit(
      payload,
      doc,
      entry,
      {
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.result === undefined ? {} : { result: input.result }),
        state: input.outcome,
      },
      req,
    )
    return snapshotOf(await loadOperationByPublicId(payload, input.operationId, req))
  })
}

export type CancelInput = {
  readonly operationId: string
  readonly reason: string
  readonly user: unknown
}

export async function cancelOperation(
  payload: Payload,
  input: CancelInput,
): Promise<OperationSnapshot> {
  return runOutboxScopedTransaction(payload, async (req) => {
    const claims = requireServiceIdentity(input.user)
    const doc = await loadOperationByPublicId(payload, input.operationId, req)
    assertTenantScope(claims, doc)
    const aggregate = aggregateOf(doc)
    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw fail("OPERATIONS_INPUT_INVALID", "service identity is not serializable")
    }
    const entry: LedgerAuditEntry = {
      action: "operation.cancelled",
      actor,
      at: ledgerClock.now().value,
      reason: input.reason,
    }
    const transitionActor = serviceActorOf(doc.operationId, numberField(doc.tenant) ?? -1)
    if (transitionActor === null) {
      throw fail("OPERATION_STATE_INVALID", "operation identity is not resolvable")
    }
    const transitioned = transitionOperation(aggregate, "cancelled", {
      actor: transitionActor,
      clock: ledgerClock,
      expectedRevision: aggregate.revision,
    })
    if (!transitioned.ok) {
      throw new OperationsLedgerError(transitioned.error.code, transitioned.error.message)
    }
    await appendAudit(payload, doc, entry, { state: "cancelled" }, req)
    return snapshotOf(await loadOperationByPublicId(payload, input.operationId, req))
  })
}

export type NonTerminalResult = {
  readonly operations: readonly OperationSnapshot[]
}

/**
 * Recovery source of truth: enumerate queued/running operations straight
 * from PostgreSQL. After a Redis loss the queue is rebuilt from this list
 * with `operationJobIdOf`; queue state is never the only recovery source.
 */
export async function listNonTerminalOperations(
  payload: Payload,
  user: unknown,
  limit = 100,
): Promise<NonTerminalResult> {
  const claims = requireServiceIdentity(user)
  const found = await payload.find({
    collection: "operations",
    where: {
      and: [
        { state: { in: ["queued", "running"] } },
        ...(claims.role === "super-admin"
          ? []
          : [{ tenant: { equals: Number(claims.tenantId ?? -1) } }]),
      ],
    },
    sort: "createdAt",
    limit,
    depth: 0,
    overrideAccess: true,
  })
  return { operations: found.docs.map((doc) => snapshotOf(doc as unknown as LedgerOperationDoc)) }
}

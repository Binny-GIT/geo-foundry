import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { appendOutboxEvent, OUTBOX_EVENT, runOutboxScopedTransaction, type TransactionScope } from "../outbox/outbox"
import { canonicalize } from "./edition-input-hash"
import {
  assertEditionTenantScope,
  EditionWorkflowError,
  loadWorkflowEdition,
  numberFieldOf,
  parseWorkflowStatus,
  serializedActorOf,
  type AuditEntry,
  type WorkflowEditionDoc,
} from "./edition-workflow"
import { operationRequestHashOf, operationUniqueKeyOf } from "./operations-ledger"

export class EditionVersionHistoryError extends Error {
  override readonly name = "EditionVersionHistoryError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail: string): EditionVersionHistoryError =>
  new EditionVersionHistoryError(code, detail)

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === "23505" ||
    (typeof candidate.message === "string" &&
      (candidate.message.includes("duplicate key value violates unique constraint") ||
        candidate.message.includes("field is invalid: uniqueKey")))
  )
}

export type EditionVersionSnapshot = Readonly<{
  angle: string
  body: unknown
  citations: unknown
  creationOrigin: string
  entities: unknown
  primaryTopic: string
  secondaryTopics: readonly string[]
  summary: string
  title: string
}>

export type EditionVersionHistoryItem = Readonly<{
  createdAt: string
  draft: boolean
  id: string
  latest: boolean
  snapshot: EditionVersionSnapshot
  updatedAt: string
  workflowStatus: string
}>

type StoredVersion = Readonly<{
  createdAt: unknown
  id: unknown
  latest?: unknown
  updatedAt: unknown
  version: unknown
}>

const snapshotOf = (value: unknown): EditionVersionSnapshot | null => {
  const row = recordOf(value)
  if (row === null) return null
  const title = textOf(row["title"])
  const summary = textOf(row["summary"])
  const angle = textOf(row["angle"])
  const primaryTopic = textOf(row["primaryTopic"])
  const creationOrigin = textOf(row["creationOrigin"])
  const body = row["body"]
  if (
    title === null ||
    summary === null ||
    angle === null ||
    primaryTopic === null ||
    creationOrigin === null ||
    !Array.isArray(body)
  ) {
    return null
  }
  return {
    angle,
    body: clone(body),
    citations: clone(row["citations"] ?? null),
    creationOrigin,
    entities: clone(row["entities"] ?? null),
    primaryTopic,
    secondaryTopics: Array.isArray(row["secondaryTopics"])
      ? row["secondaryTopics"].filter((item): item is string => typeof item === "string")
      : [],
    summary,
    title,
  }
}

const historyItemOf = (value: StoredVersion): EditionVersionHistoryItem | null => {
  const snapshot = snapshotOf(value.version)
  const id = textOf(value.id)
  const version = recordOf(value.version)
  const createdAt = textOf(value.createdAt)
  const updatedAt = textOf(value.updatedAt)
  if (snapshot === null || id === null || version === null || createdAt === null || updatedAt === null) {
    return null
  }
  let workflowStatus = "draft"
  try {
    workflowStatus = parseWorkflowStatus(version["workflowStatus"])
  } catch {
    // Historical rows written before the workflow fields existed remain readable.
  }
  return {
    createdAt,
    draft: version["_status"] === "draft",
    id,
    latest: value.latest === true,
    snapshot,
    updatedAt,
    workflowStatus,
  }
}

const versionStore = (payload: Payload) =>
  payload as unknown as {
    findVersions(options: Record<string, unknown>): Promise<{ readonly docs: readonly StoredVersion[] }>
  }

const restoreStore = (payload: Payload) =>
  payload as unknown as {
    create(options: Record<string, unknown>): Promise<unknown>
    find(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
    update(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
  }

const ensureReadableEdition = async (
  payload: Payload,
  editionId: number,
  user: unknown,
): Promise<WorkflowEditionDoc> => {
  const claims = resolveSessionClaims(user)
  if (claims === null) throw fail("EDITION_VERSION_UNAUTHENTICATED", "session has no valid claims")
  try {
    const doc = await payload.findByID({
      collection: "content-editions",
      depth: 0,
      draft: true,
      id: editionId,
      overrideAccess: false,
      user,
    })
    return doc as unknown as WorkflowEditionDoc
  } catch {
    throw fail("EDITION_VERSION_NOT_FOUND", `edition ${editionId}`)
  }
}

export const editionVersionHistory = async (
  payload: Payload,
  input: { readonly editionId: number; readonly user: unknown },
): Promise<readonly EditionVersionHistoryItem[]> => {
  await ensureReadableEdition(payload, input.editionId, input.user)
  const versions = await versionStore(payload).findVersions({
    collection: "content-editions",
    depth: 0,
    limit: 20,
    overrideAccess: false,
    sort: "-createdAt",
    user: input.user,
    where: { parent: { equals: input.editionId } },
  })
  return versions.docs.map(historyItemOf).filter((item): item is EditionVersionHistoryItem => item !== null)
}

export type RestoreEditionDraftInput = Readonly<{
  editionId: number
  expectedRevision: number
  expectedUpdatedAt: string
  idempotencyKey: string
  reason: string
  requestId: string
  user: unknown
  versionId: string
}>

export type RestoreEditionDraftResponse = Readonly<{
  editionId: number
  restoredVersionId: string
  updatedAt: string
}>

export type RestoreEditionDraftOutcome = Readonly<{
  created: boolean
  response: RestoreEditionDraftResponse
}>

type RestoreRecord = Readonly<{
  id: number
  replayCount: unknown
  requestHash: string
  responsePayload: unknown
}>

const restoreEndpointOf = (editionId: number): string => `/workspaces/editions/${editionId}/restore-draft`

const loadRestoreRecord = async (
  payload: Payload,
  uniqueKey: string,
  req: TransactionScope = {},
): Promise<RestoreRecord | null> => {
  const found = await restoreStore(payload).find({
    collection: "edition-draft-restore-idempotency",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { uniqueKey: { equals: uniqueKey } },
  })
  return (found.docs[0] as RestoreRecord | undefined) ?? null
}

const responseOf = (value: unknown): RestoreEditionDraftResponse => {
  const row = recordOf(value)
  const editionId = numberOf(row?.["editionId"])
  const restoredVersionId = textOf(row?.["restoredVersionId"])
  const updatedAt = textOf(row?.["updatedAt"])
  if (editionId === null || restoredVersionId === null || updatedAt === null) {
    throw fail("EDITION_DRAFT_RESTORE_IDEMPOTENCY_INVALID", "stored response is invalid")
  }
  return { editionId, restoredVersionId, updatedAt }
}

const replay = async (payload: Payload, record: RestoreRecord): Promise<RestoreEditionDraftOutcome> => {
  await restoreStore(payload).update({
    collection: "edition-draft-restore-idempotency",
    data: { replayCount: (numberOf(record.replayCount) ?? 0) + 1 },
    depth: 0,
    id: record.id,
    overrideAccess: true,
  })
  return { created: false, response: responseOf(record.responsePayload) }
}

export const restorableEditionFieldsOf = (snapshot: EditionVersionSnapshot): Record<string, unknown> => ({
  angle: snapshot.angle,
  body: clone(snapshot.body),
  citations: clone(snapshot.citations),
  creationOrigin: snapshot.creationOrigin,
  entities: clone(snapshot.entities),
  primaryTopic: snapshot.primaryTopic,
  secondaryTopics: [...snapshot.secondaryTopics],
  summary: snapshot.summary,
  title: snapshot.title,
})

const editorClaimsOf = (user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null) throw fail("EDITION_DRAFT_RESTORE_UNAUTHENTICATED", "session has no valid claims")
  if (claims.kind !== "user" || claims.role !== "editor" || claims.tenantId === null) {
    throw fail("EDITION_DRAFT_RESTORE_EDITOR_REQUIRED", "editor identity is required")
  }
  const tenantId = Number(claims.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw fail("EDITION_DRAFT_RESTORE_UNAUTHENTICATED", "editor tenant is invalid")
  }
  return { claims, tenantId }
}

export async function restoreEditionDraft(
  payload: Payload,
  input: RestoreEditionDraftInput,
): Promise<RestoreEditionDraftOutcome> {
  const { claims, tenantId } = editorClaimsOf(input.user)
  const endpoint = restoreEndpointOf(input.editionId)
  const requestHash = operationRequestHashOf(
    canonicalize({
      expectedRevision: input.expectedRevision,
      expectedUpdatedAt: input.expectedUpdatedAt,
      reason: input.reason,
      versionId: input.versionId,
    }),
  )
  const uniqueKey = operationUniqueKeyOf(tenantId, endpoint, input.idempotencyKey)
  const existing = await loadRestoreRecord(payload, uniqueKey)
  if (existing !== null) {
    if (existing.requestHash !== requestHash) {
      throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different restore")
    }
    return replay(payload, existing)
  }

  try {
    return await runOutboxScopedTransaction(payload, async (req) => {
      const raced = await loadRestoreRecord(payload, uniqueKey, req)
      if (raced !== null) {
        if (raced.requestHash !== requestHash) {
          throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different restore")
        }
        return { created: false, response: responseOf(raced.responsePayload) }
      }

      const doc = await loadWorkflowEdition(payload, input.editionId, req, true)
      assertEditionTenantScope(input.user, doc)
      const revision = numberFieldOf(doc.workflowRevision)
      if (revision === null || revision !== input.expectedRevision) {
        throw new EditionWorkflowError("EDITION_WORKFLOW_REVISION_CONFLICT", `edition ${input.editionId}`)
      }
      if (parseWorkflowStatus(doc.workflowStatus) !== "draft") {
        throw fail("EDITION_DRAFT_RESTORE_DRAFT_REQUIRED", `edition ${input.editionId}`)
      }
      if (textOf(doc.updatedAt) !== input.expectedUpdatedAt) {
        throw fail("EDITION_DRAFT_RESTORE_STALE", `edition ${input.editionId}`)
      }

      const versions = await versionStore(payload).findVersions({
        collection: "content-editions",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        where: {
          and: [{ id: { equals: input.versionId } }, { parent: { equals: input.editionId } }],
        },
      })
      const source = versions.docs[0]
      const snapshot = source === undefined ? null : snapshotOf(source.version)
      if (snapshot === null) throw fail("EDITION_DRAFT_RESTORE_VERSION_NOT_FOUND", input.versionId)

      const actor = serializedActorOf(input.user)
      if (actor === null) throw fail("EDITION_DRAFT_RESTORE_UNAUTHENTICATED", "actor is not serializable")
      const normalizedReason = input.reason.trim()
      if (normalizedReason.length === 0) throw fail("EDITION_DRAFT_RESTORE_REASON_REQUIRED", "reason is required")
      const existingAudit = Array.isArray(doc.auditLog) ? (doc.auditLog as AuditEntry[]) : []
      const previousState = parseWorkflowStatus(doc.workflowStatus)
      const audit: AuditEntry = {
        action: "content-edition.history.draft",
        actor,
        at: new Date().toISOString(),
        detail: { restoredVersionId: input.versionId },
        from: previousState,
        reason: normalizedReason,
        tenantId,
        to: "draft",
      }
      const updated = await restoreStore(payload).update({
        collection: "content-editions",
        data: {
          ...restorableEditionFieldsOf(snapshot),
          auditLog: [...existingAudit, audit],
          compiledRelease: null,
          workflowRevision: input.expectedRevision + 1,
          workflowStatus: "draft",
        },
        depth: 0,
        draft: true,
        overrideAccess: true,
        req,
        where: {
          and: [
            { id: { equals: input.editionId } },
            { workflowRevision: { equals: input.expectedRevision } },
            { updatedAt: { equals: input.expectedUpdatedAt } },
          ],
        },
      })
      const restored = (updated.docs[0] as WorkflowEditionDoc | undefined) ?? null
      if (updated.docs.length !== 1 || restored === null || textOf(restored.updatedAt) === null) {
        throw fail("EDITION_DRAFT_RESTORE_STALE", `edition ${input.editionId}`)
      }
      const response: RestoreEditionDraftResponse = {
        editionId: input.editionId,
        restoredVersionId: input.versionId,
        updatedAt: textOf(restored.updatedAt) as string,
      }
      await appendOutboxEvent(
        payload,
        {
          aggregateId: input.editionId,
          eventPayload: {
            from: previousState,
            reason: normalizedReason,
            restoredVersionId: input.versionId,
            to: "draft",
            workflowRevision: input.expectedRevision + 1,
          },
          requestId: input.requestId,
          tenantId,
          type: OUTBOX_EVENT.EDITION_DRAFT_WRITTEN,
        },
        req,
      )
      await restoreStore(payload).create({
        collection: "edition-draft-restore-idempotency",
        data: {
          actorUserId: claims.userId,
          edition: input.editionId,
          endpoint,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          requestId: input.requestId,
          responsePayload: response,
          tenant: tenantId,
          uniqueKey,
          versionId: input.versionId,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return { created: true, response }
    })
  } catch (error) {
    const stale = error instanceof EditionVersionHistoryError && error.code === "EDITION_DRAFT_RESTORE_STALE"
    if (!isUniqueViolation(error) && !stale) throw error
    const winner = await loadRestoreRecord(payload, uniqueKey)
    if (winner === null) throw error
    if (winner.requestHash !== requestHash) {
      throw fail("IDEMPOTENCY_KEY_REUSED", "idempotency key is bound to a different restore")
    }
    return replay(payload, winner)
  }
}

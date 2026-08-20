import type { ContentEditionState } from "@geo/domain"
import type { Payload } from "payload"

import { OUTBOX_EVENT, appendOutboxEvent, runOutboxScopedTransaction } from "../outbox/outbox"
import {
  EditionWorkflowError,
  assertEditionTenantScope,
  currentEditionInputHash,
  loadWorkflowEdition,
  numberFieldOf,
  parseWorkflowStatus,
  requireServiceIdentity,
  serializedActorOf,
  systemClockOf,
  type AuditEntry,
  type WorkflowEditionDoc,
} from "./edition-workflow"

const fail = (code: string, detail: string): EditionWorkflowError =>
  new EditionWorkflowError(code, detail)

export type EditionInputSnapshot = {
  readonly body: unknown
  readonly contentId: number
  readonly editionId: number
  readonly inputHash: string
  readonly modifiedAt: string
  readonly publishedAt: string
  readonly primaryTopic: unknown
  readonly secondaryTopics: unknown
  readonly siteId: number
  readonly summary: unknown
  readonly tenantId: number
  readonly title: unknown
  readonly workflowRevision: number
  readonly workflowStatus: ContentEditionState
}

export type ReadEditionInputOptions = {
  readonly editionId: number
  readonly user: unknown
}

/** Immutable generation input for the content-service: raw fields plus hash. */
export async function readEditionInput(
  payload: Payload,
  options: ReadEditionInputOptions,
): Promise<EditionInputSnapshot> {
  const doc = await loadWorkflowEdition(payload, options.editionId)
  assertEditionTenantScope(options.user, doc)
  return {
    body: doc.body,
    contentId: numberFieldOf(doc.content) ?? -1,
    editionId: doc.id,
    inputHash: currentEditionInputHash(doc),
    modifiedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : String(doc.updatedAt),
    publishedAt: typeof doc.createdAt === "string" ? doc.createdAt : String(doc.createdAt),
    primaryTopic: doc.primaryTopic,
    secondaryTopics: doc.secondaryTopics,
    siteId: numberFieldOf(doc.site) ?? -1,
    summary: doc.summary,
    tenantId: numberFieldOf(doc.tenant) ?? -1,
    title: doc.title,
    workflowRevision: numberFieldOf(doc.workflowRevision) ?? 0,
    workflowStatus: parseWorkflowStatus(doc.workflowStatus),
  }
}

export type GeneratedDraftPatch = {
  readonly body?: unknown
  readonly primaryTopic?: string
  readonly secondaryTopics?: readonly string[]
  readonly summary?: string
  readonly title?: string
}

export type DraftWriteReceipt = {
  readonly fields: readonly string[]
  readonly inputHash: string
  readonly workflowRevision: number
  readonly workflowStatus: ContentEditionState
}

export type WriteDraftVersionOptions = {
  readonly editionId: number
  readonly operationId?: string
  readonly patch: GeneratedDraftPatch
  readonly requestId?: string
  readonly user: unknown
}

const patchDataOf = (patch: GeneratedDraftPatch): Record<string, unknown> => {
  const data: Record<string, unknown> = {}
  if (patch.body !== undefined) {
    data["body"] = patch.body
  }
  if (patch.primaryTopic !== undefined) {
    data["primaryTopic"] = patch.primaryTopic
  }
  if (patch.secondaryTopics !== undefined) {
    data["secondaryTopics"] = patch.secondaryTopics
  }
  if (patch.summary !== undefined) {
    data["summary"] = patch.summary
  }
  if (patch.title !== undefined) {
    data["title"] = patch.title
  }
  return data
}

/**
 * Generated-version write for the content-service identity. The edition must
 * still be mutable (draft/generating); the collection hooks enforce the
 * PageDocument body contract, and the write plus its outbox event commit in
 * one transaction.
 */
export async function writeGeneratedDraft(
  payload: Payload,
  options: WriteDraftVersionOptions,
): Promise<DraftWriteReceipt> {
  requireServiceIdentity(options.user)
  return runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, options.editionId, req)
    assertEditionTenantScope(options.user, doc)
    const status = parseWorkflowStatus(doc.workflowStatus)
    if (status !== "draft" && status !== "generating") {
      throw fail("EDITION_WORKFLOW_NOT_WRITABLE", `edition ${options.editionId} is ${status}`)
    }
    const data = patchDataOf(options.patch)
    const fields = Object.keys(data)
    if (fields.length === 0) {
      throw fail("EDITION_PATCH_EMPTY", `edition ${options.editionId}`)
    }
    const updated = (await payload.update({
      collection: "content-editions",
      id: options.editionId,
      data,
      overrideAccess: true,
      depth: 0,
      req,
    })) as unknown as WorkflowEditionDoc
    const inputHash = currentEditionInputHash(updated)
    const workflowRevision = numberFieldOf(updated.workflowRevision) ?? 0
    await appendOutboxEvent(
      payload,
      {
        aggregateId: options.editionId,
        eventPayload: {
          fields,
          inputHash,
          workflowRevision,
          workflowStatus: status,
        },
        tenantId: numberFieldOf(doc.tenant) ?? -1,
        type: OUTBOX_EVENT.EDITION_DRAFT_WRITTEN,
        ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      },
      req,
    )
    return { fields, inputHash, workflowRevision, workflowStatus: status }
  })
}

export type CompileResultInput = {
  readonly editionId: number
  readonly manifestSha256: string
  readonly objectCount: number
  readonly operationId?: string
  readonly releaseId: string
  readonly requestId?: string
  readonly totalBytes: number
  readonly user: unknown
}

export type CompileResultReceipt = {
  readonly releaseId: string
  readonly workflowStatus: ContentEditionState
}

/**
 * Compile evidence recording. The worker reports a verified artifact for an
 * approved edition; the CMS stores the metadata as an audit entry plus an
 * outbox event and never performs compiler work itself.
 */
export async function recordCompileResult(
  payload: Payload,
  input: CompileResultInput,
): Promise<CompileResultReceipt> {
  requireServiceIdentity(input.user)
  return runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, input.editionId, req)
    assertEditionTenantScope(input.user, doc)
    const status = parseWorkflowStatus(doc.workflowStatus)
    if (status !== "approved" && status !== "compiled") {
      throw fail("EDITION_WORKFLOW_NOT_APPROVED", `edition ${input.editionId} is ${status}`)
    }
    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw fail("EDITION_WORKFLOW_SERVICE_REQUIRED", "compile result requires a service actor")
    }
    const entry: AuditEntry = {
      action: "edition.compile.recorded",
      actor,
      at: systemClockOf().value,
      detail: {
        manifestSha256: input.manifestSha256,
        objectCount: input.objectCount,
        releaseId: input.releaseId,
        totalBytes: input.totalBytes,
      },
      from: status,
      tenantId: numberFieldOf(doc.tenant) ?? -1,
      to: status,
    }
    const existingAudit = Array.isArray(doc.auditLog) ? doc.auditLog : []
    await payload.update({
      collection: "content-editions",
      id: input.editionId,
      data: { auditLog: [...existingAudit, entry] },
      overrideAccess: true,
      depth: 0,
      req,
    })
    await appendOutboxEvent(
      payload,
      {
        aggregateId: input.editionId,
        eventPayload: {
          manifestSha256: input.manifestSha256,
          objectCount: input.objectCount,
          releaseId: input.releaseId,
          totalBytes: input.totalBytes,
          workflowStatus: status,
        },
        tenantId: numberFieldOf(doc.tenant) ?? -1,
        type: OUTBOX_EVENT.EDITION_COMPILE_RECORDED,
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      },
      req,
    )
    return { releaseId: input.releaseId, workflowStatus: status }
  })
}

export type PublishRequestInput = {
  readonly editionId: number
  readonly operationId?: string
  readonly reason?: string
  readonly requestId?: string
  readonly user: unknown
}

export type PublishRequestReceipt = {
  readonly releaseId: string
  readonly workflowStatus: ContentEditionState
}

/**
 * Publish intent recording. The CMS records that the content-service asked
 * for publication of a compiled edition; the actual publish transition stays
 * with the publisher role through the workflow service.
 */
export async function requestPublish(
  payload: Payload,
  input: PublishRequestInput,
): Promise<PublishRequestReceipt> {
  requireServiceIdentity(input.user)
  return runOutboxScopedTransaction(payload, async (req) => {
    const doc = await loadWorkflowEdition(payload, input.editionId, req)
    assertEditionTenantScope(input.user, doc)
    const status = parseWorkflowStatus(doc.workflowStatus)
    if (status !== "compiled") {
      throw fail("EDITION_WORKFLOW_NOT_COMPILED", `edition ${input.editionId} is ${status}`)
    }
    const releaseId =
      typeof doc.compiledRelease === "string" && doc.compiledRelease.length > 0
        ? doc.compiledRelease
        : null
    if (releaseId === null) {
      throw fail("EDITION_WORKFLOW_NOT_COMPILED", `edition ${input.editionId} has no release`)
    }
    const actor = serializedActorOf(input.user)
    if (actor === null) {
      throw fail("EDITION_WORKFLOW_SERVICE_REQUIRED", "publish request requires a service actor")
    }
    const entry: AuditEntry = {
      action: "publish.requested",
      actor,
      at: systemClockOf().value,
      from: status,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      tenantId: numberFieldOf(doc.tenant) ?? -1,
      to: status,
    }
    const existingAudit = Array.isArray(doc.auditLog) ? doc.auditLog : []
    await payload.update({
      collection: "content-editions",
      id: input.editionId,
      data: { auditLog: [...existingAudit, entry] },
      overrideAccess: true,
      depth: 0,
      req,
    })
    await appendOutboxEvent(
      payload,
      {
        aggregateId: input.editionId,
        eventPayload: {
          releaseId,
          workflowStatus: status,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        tenantId: numberFieldOf(doc.tenant) ?? -1,
        type: OUTBOX_EVENT.PUBLISH_REQUESTED,
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      },
      req,
    )
    return { releaseId, workflowStatus: status }
  })
}

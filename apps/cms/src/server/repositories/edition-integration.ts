/*
 * 内部集成服务 Drizzle 实现：生成草稿写入 / 编译结果 / 质量评估 /
 * 输入快照读取。契约（错误码、审计形状、outbox 事件、幂等语义）与
 * services/edition-integration.ts + recordAssessment 保持一致。
 */


import type { ContentEditionState } from "@geo/domain"
import { eq } from "drizzle-orm"

import { markdownToBlocks, blocksToMarkdown } from "../../editor/block-markdown"
import { validateEditionBody } from "../../editor/validate-body"
import { resolveSessionClaims } from "../../access/session"
import { hashEditionContent } from "../../services/edition-input-hash"
import { EditionWorkflowError } from "../../services/edition-workflow"
import type { ServerDb } from "../db/client"
import { sendEditionEmbeddingJobWithin } from "../jobs/pgboss"
import { editionVersions } from "../db/edition-schema"
import { qualityAssessments } from "../db/session-schema"
import {
  insertLatestVersion,
  loadCurrentVersion,
  transitionEditionWithinTx,
  workflowActorOf,
  type WorkflowClaims,
} from "./edition-workflow"
import type { EntityScope } from "./entities"

/* guards 的错误映射已覆盖 EditionWorkflowError；沿用保证状态码契约不变。 */
const fail = (code: string): EditionWorkflowError => new EditionWorkflowError(code)

/** internal 调用方是租户绑定的 content-service；scope 即其租户。 */
export const serviceScopeOf = (user: unknown): EntityScope => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw fail("EDITION_WORKFLOW_SERVICE_REQUIRED")
  }
  const tenantId = Number(claims.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw fail("EDITION_WORKFLOW_TENANT_MISMATCH")
  return { kind: "tenant", tenantId }
}

const claimsOfActor = (user: unknown): WorkflowClaims => {
  const claims = resolveSessionClaims(user)
  if (claims === null) throw fail("EDITION_WORKFLOW_ACTOR_INVALID")
  return {
    kind: claims.kind === "service" ? "service" : "user",
    role: claims.role,
    tenantId: claims.tenantId === null ? null : Number(claims.tenantId),
    userId: claims.userId,
  }
}

const topicsOf = (version: typeof editionVersions.$inferSelect): string[] => version.secondaryTopics

export type EditionInputSnapshot = {
  readonly body: unknown
  readonly compiledRelease: string | null
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

export const readEditionInput = async (
  db: ServerDb,
  options: { readonly editionId: number; readonly user: unknown },
): Promise<EditionInputSnapshot> => {
  const scope = serviceScopeOf(options.user)
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, options.editionId)
    const body = markdownToBlocks(version.bodyMarkdown ?? "")
    const secondaryTopics = topicsOf(version)
    const title = version.title ?? ""
    const summary = version.summary ?? ""
    const primaryTopic = version.primaryTopic ?? ""
    return {
      body,
      compiledRelease: version.compiledRelease ?? null,
      editionId: options.editionId,
      inputHash: hashEditionContent({ body, primaryTopic, secondaryTopics, summary, title }),
      // Payload draft:true 返回的是 version_* 副本列，publishedAt 对应 version_created_at。
      modifiedAt: (
        version.contentModifiedAt ??
        version.versionUpdatedAt ??
        version.updatedAt
      ).toISOString(),
      publishedAt: (version.versionCreatedAt ?? version.createdAt).toISOString(),
      primaryTopic,
      secondaryTopics,
      siteId: version.siteId ?? -1,
      summary,
      tenantId: version.tenantId ?? -1,
      title,
      workflowRevision: Number(version.workflowRevision ?? 0),
      workflowStatus: (version.workflowStatus ?? "draft") as ContentEditionState,
    }
  })
}

export type GeneratedDraftPatch = {
  readonly body?: unknown
  readonly primaryTopic?: string
  readonly secondaryTopics?: readonly string[]
  readonly summary?: string
  readonly title?: string
}

export const writeGeneratedDraft = async (
  db: ServerDb,
  options: {
    readonly editionId: number
    readonly operationId?: string
    readonly patch: GeneratedDraftPatch
    readonly requestId?: string
    readonly user: unknown
  },
): Promise<{
  readonly fields: readonly string[]
  readonly inputHash: string
  readonly workflowRevision: number
  readonly workflowStatus: ContentEditionState
}> => {
  const scope = serviceScopeOf(options.user)
  if (options.patch.body !== undefined) {
    const validation = validateEditionBody(options.patch.body)
    if (validation !== true) throw fail("EDITION_BODY_INVALID")
  }
  const fieldKeys: readonly (keyof GeneratedDraftPatch)[] = [
    "body",
    "primaryTopic",
    "secondaryTopics",
    "summary",
    "title",
  ]
  const fields = fieldKeys.filter((key) => options.patch[key] !== undefined)
  if (fields.length === 0) throw fail("EDITION_PATCH_EMPTY")
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, options.editionId)
    const status = version.workflowStatus ?? "draft"
    if (status !== "draft" && status !== "generating") {
      throw fail("EDITION_WORKFLOW_NOT_WRITABLE")
    }
    const nextMarkdown =
      options.patch.body === undefined
        ? (version.bodyMarkdown ?? "")
        : blocksToMarkdown(options.patch.body as readonly Record<string, unknown>[])
    const nextTitle = options.patch.title ?? version.title ?? ""
    const nextSummary = options.patch.summary ?? version.summary ?? ""
    const nextPrimaryTopic = options.patch.primaryTopic ?? version.primaryTopic ?? ""
    const nextTopics =
      options.patch.secondaryTopics === undefined
        ? topicsOf(version)
        : [...options.patch.secondaryTopics]
    const inputHash = hashEditionContent({
      body: markdownToBlocks(nextMarkdown),
      primaryTopic: nextPrimaryTopic,
      secondaryTopics: nextTopics,
      summary: nextSummary,
      title: nextTitle,
    })
    const workflowRevision = Number(version.workflowRevision ?? 0)
    const newVersionId = await insertLatestVersion(tx, version, {
      auditLog: version.auditLog ?? [],
      compiledRelease: version.compiledRelease,
      workflowRevision: version.workflowRevision ?? 0,
      workflowStatus: version.workflowStatus ?? "draft",
    })
    await tx
      .update(editionVersions)
      .set({
        bodyMarkdown: nextMarkdown,
        ...(options.patch.primaryTopic === undefined
          ? {}
          : { primaryTopic: options.patch.primaryTopic }),
        ...(options.patch.summary === undefined ? {} : { summary: options.patch.summary }),
        ...(options.patch.title === undefined ? {} : { title: options.patch.title }),
        secondaryTopics: nextTopics,
      })
      .where(eq(editionVersions.id, newVersionId))
    await sendEditionEmbeddingJobWithin(tx, {
      editionId: options.editionId,
      tenantId: version.tenantId ?? -1,
    })
    return { fields, inputHash, workflowRevision, workflowStatus: status as ContentEditionState }
  })
}

export const recordCompileResult = async (
  db: ServerDb,
  input: {
    readonly editionId: number
    readonly manifestSha256: string
    readonly objectCount: number
    readonly operationId?: string
    readonly releaseId: string
    readonly requestId?: string
    readonly totalBytes: number
    readonly user: unknown
  },
): Promise<{ readonly releaseId: string; readonly workflowStatus: ContentEditionState }> => {
  const scope = serviceScopeOf(input.user)
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, input.editionId)
    const status = version.workflowStatus ?? "draft"
    if (status !== "approved" && status !== "compiled") {
      throw fail("EDITION_WORKFLOW_NOT_APPROVED")
    }
    const existingAudit = Array.isArray(version.auditLog) ? version.auditLog : []
    if (status === "compiled") {
      const evidence = [...existingAudit]
        .reverse()
        .map((entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>)["action"] === "edition.compile.recorded"
            ? (((entry as Record<string, unknown>)["detail"] as
                | Record<string, unknown>
                | undefined) ?? null)
            : null,
        )
        .find((detail) => detail?.["releaseId"] === version.compiledRelease)
      if (
        version.compiledRelease === input.releaseId &&
        evidence !== undefined &&
        evidence !== null &&
        evidence["manifestSha256"] === input.manifestSha256 &&
        evidence["objectCount"] === input.objectCount &&
        evidence["releaseId"] === input.releaseId &&
        evidence["totalBytes"] === input.totalBytes
      ) {
        return { releaseId: input.releaseId, workflowStatus: "compiled" as const }
      }
      throw fail("EDITION_WORKFLOW_COMPILE_CONFLICT")
    }
    const actor = claimsOfActor(input.user)
    const auditEntry = {
      action: "edition.compile.recorded",
      actor: { kind: actor.kind, role: actor.role, tenantId: actor.tenantId, userId: actor.userId },
      at: new Date().toISOString(),
      detail: {
        manifestSha256: input.manifestSha256,
        objectCount: input.objectCount,
        releaseId: input.releaseId,
        totalBytes: input.totalBytes,
      },
      from: status,
      tenantId: version.tenantId ?? -1,
      to: "compiled",
    }
    // 与旧实现同构：先落证据版本行，再由转移追加 approved→compiled 版本行。
    await insertLatestVersion(tx, version, {
      auditLog: [...existingAudit, auditEntry],
      compiledRelease: version.compiledRelease,
      workflowRevision: version.workflowRevision ?? 0,
      workflowStatus: version.workflowStatus ?? "draft",
    })
    await transitionEditionWithinTx(tx, {
      actor: workflowActorOf(actor),
      compiledReleaseId: input.releaseId,
      editionId: input.editionId,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      scope,
      target: "compiled",
    })
    return { releaseId: input.releaseId, workflowStatus: "compiled" as const }
  })
}

export const recordAssessment = async (
  db: ServerDb,
  input: {
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
  },
): Promise<number> => {
  const scope = input.user === undefined ? null : serviceScopeOf(input.user)
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope ?? { kind: "global" }, input.editionId)
    if (scope !== null && scope.kind === "tenant" && version.tenantId !== scope.tenantId) {
      throw fail("EDITION_WORKFLOW_TENANT_MISMATCH")
    }
    const inserted = await tx
      .insert(qualityAssessments)
      .values({
        editionId: input.editionId,
        inputHash: input.inputHash,
        issues: input.issues.map((issue) => ({ ...issue })),
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        provider: input.provider,
        siteId: version.siteId ?? -1,
        state: input.state,
        tenantId: version.tenantId ?? -1,
        thresholdsHash: input.thresholdsHash,
      })
      .returning({ id: qualityAssessments.id })
    const assessmentId = inserted[0]?.id
    if (assessmentId === undefined) throw fail("ASSESSMENT_WRITE_FAILED")
    return assessmentId
  })
}

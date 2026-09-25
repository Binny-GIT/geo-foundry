/*
 * 内部集成服务 Drizzle 实现：生成草稿写入 / 编译结果 / 质量评估 /
 * 输入快照读取。契约（错误码、审计形状、任务事件、幂等语义）与
 * services/edition-integration.ts + recordAssessment 保持一致。
 */

import type { ContentEditionState } from "@geo/domain"
import { and, eq } from "drizzle-orm"
import { resolveSessionClaims } from "../../access/session"
import { blocksToMarkdown, markdownToBlocks } from "../../editor/block-markdown"
import { validateEditionBody } from "../../editor/validate-body"
import { hashEditionContent } from "../../services/edition-input-hash"
import { EditionWorkflowError } from "../../services/edition-workflow"
import type { ServerDb } from "../db/client"
import { editionSites, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { qualityAssessments } from "../db/session-schema"
import { sendEditionEmbeddingJobWithin } from "../jobs/pgboss"
import {
  compileSitePatchOf,
  desiredEditionSiteIdsOf,
  editionSiteRowOf,
  updateEditionSiteRow,
} from "./edition-sites"
import {
  insertLatestVersion,
  loadCurrentVersion,
  transitionEditionWithinTx,
  type WorkflowClaims,
  workflowActorOf,
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
  /** 内容层合并后 content 标识即 editionId（与编译快照 mapEdition 一致）。 */
  readonly contentId: number
  readonly editionId: number
  readonly inputHash: string
  readonly modifiedAt: string
  readonly publishedAt: string
  readonly primaryTopic: unknown
  readonly secondaryTopics: unknown
  /** A3：成员站点（版本 site ∪ sites 去重），worker 预热 embedding 按它落站。 */
  readonly sites: readonly number[]
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
    const sites = desiredEditionSiteIdsOf({ siteId: version.siteId, sites: version.sites })
    return {
      body,
      compiledRelease: version.compiledRelease ?? null,
      contentId: options.editionId,
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
      sites,
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

/**
 * 编译回执（A2 按"文章 × 站点 × release"记录）：
 * - 证据（edition.compile.recorded 审计 detail，含 siteId）命中同 (站点, release)
 *   且哈希全匹配 → 幂等返回，不动任何行；
 * - 首个站点（文章 approved）→ 证据版本行 + 文章级 approved→compiled 转移，
 *   并复位本站行（publish_state 回 pending、清 url_record_id/published_at）；
 * - 后续站点（文章 compiled，或他站已 published 的单站重试）→ 只落证据版本行
 *   （单值 compiledRelease 写最近一次，兼容旧读取方），文章状态/修订不动；
 *   若本站旧行已 published 且 release 变化，也要复位本站行。
 * 每站的 release 记在 edition_sites 行上，发布回执段按该行守卫。
 */
export const recordCompileResult = async (
  db: ServerDb,
  input: {
    readonly editionId: number
    readonly manifestSha256: string
    readonly objectCount: number
    readonly operationId?: string
    readonly releaseId: string
    readonly requestId?: string
    readonly siteId: number
    readonly totalBytes: number
    readonly user: unknown
  },
): Promise<{ readonly releaseId: string; readonly workflowStatus: ContentEditionState }> => {
  const scope = serviceScopeOf(input.user)
  return db.transaction(async (tx) => {
    const { version } = await loadCurrentVersion(tx, scope, input.editionId)
    const status = version.workflowStatus ?? "draft"
    if (status !== "approved" && status !== "compiled" && status !== "published") {
      throw fail("EDITION_WORKFLOW_NOT_APPROVED")
    }
    const row = await editionSiteRowOf(tx, input.editionId, input.siteId)
    if (row === null) {
      throw fail("EDITION_WORKFLOW_SITE_NOT_ASSIGNED")
    }
    // A4 撤下站点：该站"不含此文的新 release"的编译回执到达时站点行已是
    // unpublished——证据版本行照记（单值 compiledRelease 更新为最近一次），
    // 但不回写站点行（行状态由撤下流程负责，重放不得改写）。
    const isTakedownRerelease = row.publishState === "unpublished"
    const existingAudit = Array.isArray(version.auditLog) ? version.auditLog : []
    const evidence = existingAudit
      .map((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)["action"] === "edition.compile.recorded"
          ? (((entry as Record<string, unknown>)["detail"] as
              | Record<string, unknown>
              | undefined) ?? null)
          : null,
      )
      .find(
        (detail) =>
          detail !== null &&
          detail["releaseId"] === input.releaseId &&
          detail["siteId"] === input.siteId &&
          detail["manifestSha256"] === input.manifestSha256 &&
          detail["objectCount"] === input.objectCount &&
          detail["totalBytes"] === input.totalBytes,
      )
    if (evidence !== undefined) {
      // 幂等重放：该站该 release 的证据已记录；行上的 release 不在此回写
      // （旧操作重放晚于同站新编译时，回写会把行指回旧 release）。
      return { releaseId: input.releaseId, workflowStatus: status as ContentEditionState }
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
        siteId: input.siteId,
        totalBytes: input.totalBytes,
      },
      from: status,
      tenantId: version.tenantId ?? -1,
      to: status === "published" ? "published" : "compiled",
    }
    if (status === "approved") {
      // 首个站点：先落证据版本行，再由转移追加 approved→compiled 版本行。
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
      // 新编译周期边界：复位本站发布状态。重发布周期（dfp→重审批）时行可能
      // 还停在上一周期的 published+旧 release，不复位则发布回执段命中
      // "published 且 releaseId 匹配 → 幂等返回"分支，跳过文章级
      // compiled→published 转移，文章会卡在 compiled 并退出 delivery。
      await updateEditionSiteRow(tx, {
        editionId: input.editionId,
        patch: {
          publishState: "pending",
          publishedAt: null,
          releaseId: input.releaseId,
          urlRecordId: null,
        },
        siteId: input.siteId,
      })
      return { releaseId: input.releaseId, workflowStatus: "compiled" as const }
    }
    if (status === "compiled" || status === "published") {
      // 后续站点 / 他站已发布后的单站重试：证据版本行不推进文章状态，
      // 单值 compiledRelease 写最近一次的 release。
      await insertLatestVersion(tx, version, {
        auditLog: [...existingAudit, auditEntry],
        compiledRelease: input.releaseId,
        workflowRevision: version.workflowRevision ?? 0,
        workflowStatus: status,
      })
    }
    if (!isTakedownRerelease) {
      await updateEditionSiteRow(tx, {
        editionId: input.editionId,
        patch: compileSitePatchOf(row, input.releaseId),
        siteId: input.siteId,
      })
    }
    return { releaseId: input.releaseId, workflowStatus: status as ContentEditionState }
  })
}

export const recordAssessment = async (
  db: ServerDb,
  input: {
    readonly editionId: number
    readonly inputHash: string
    readonly issues: readonly { readonly code: string; readonly severity: string }[]
    readonly modelId: string
    readonly overall?: number
    readonly dimensions?: Readonly<Record<string, number>>
    readonly promptVersion: string
    readonly provider: string
    // A3 质量检查按站：结论落到指定成员站点；缺省落文章单数站点（旧行为）。
    readonly siteId?: number
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
    // A3：指定站点必须存在且与文章同租户（不存在/跨租户一律拒，不泄漏存在性）；
    // 缺省回退文章单数站点（可能为 -1，与旧数据行为一致）。
    let rowSiteId = version.siteId ?? -1
    if (input.siteId !== undefined) {
      const siteRows = await tx
        .select({ tenantId: sites.tenantId })
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1)
      const siteRow = siteRows[0]
      if (
        siteRow === undefined ||
        (version.tenantId !== null && version.tenantId > 0 && siteRow.tenantId !== version.tenantId)
      ) {
        throw fail("EDITION_WORKFLOW_TENANT_MISMATCH")
      }
      rowSiteId = input.siteId
    }
    const inserted = await tx
      .insert(qualityAssessments)
      .values({
        editionId: input.editionId,
        inputHash: input.inputHash,
        issues: input.issues.map((issue) => ({ ...issue })),
        modelId: input.modelId,
        ...(input.overall === undefined ? {} : { overall: String(input.overall) }),
        ...(input.dimensions === undefined ? {} : { dimensions: { ...input.dimensions } }),
        promptVersion: input.promptVersion,
        provider: input.provider,
        siteId: rowSiteId,
        state: input.state,
        tenantId: version.tenantId ?? -1,
        thresholdsHash: input.thresholdsHash,
      })
      .returning({ id: qualityAssessments.id })
    const assessmentId = inserted[0]?.id
    if (assessmentId === undefined) throw fail("ASSESSMENT_WRITE_FAILED")
    // A3：结论同步到文章 × 站点 行（新增站点行缺省 pending，评估后才有了状态；
    // 行不存在是静默 no-op——站点行由草稿保存/分配站点流程维护）。
    await tx
      .update(editionSites)
      .set({ qualityState: input.state, updatedAt: new Date() })
      .where(and(eq(editionSites.editionId, input.editionId), eq(editionSites.siteId, rowSiteId)))
    return assessmentId
  })
}

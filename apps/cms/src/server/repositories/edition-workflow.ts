/*
 * 工作流核心仓储：transition / createDraftFromPublished / URL 预留。
 * 与旧 Payload 服务（services/edition-workflow.ts，内部调用方仍在用）保持
 * 相同的物理写入语义：
 * - draft 泳道目标只写 _content_editions_v（新 latest 版本行）；
 * - published/archived 额外把 draft 内容发布到 live 根表；
 * - 审计、outbox 与业务写入同事务。
 */

import { randomUUID } from "node:crypto"

import {
  type AuditActor,
  type Clock,
  type ContentEditionState,
  createDraftEditionFromPublished,
  createUserAuditActor,
  parseContentId,
  parseEditionId,
  parseInstant,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  parseUserId,
  reserveUrl,
  transitionContentEdition,
} from "@geo/domain"
import { and, eq, inArray, sql } from "drizzle-orm"

import { buildSiteRegistry, toUrlRecordRow } from "../../services/url-registry-snapshot"
import type { ServerDb } from "../db/client"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { urlRecords } from "../db/workflow-schema"
import type { EntityScope } from "./entities"

export class WorkflowRepositoryError extends Error {
  override readonly name = "WorkflowRepositoryError"
  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): WorkflowRepositoryError => new WorkflowRepositoryError(code)

type Tx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

const workflowClock: Clock = {
  now: () => {
    const instant = parseInstant(new Date().toISOString())
    if (!instant.ok) throw fail("EDITION_WORKFLOW_CLOCK_INVALID")
    return instant.value
  },
}

export type WorkflowClaims = Readonly<{
  kind: "user" | "service"
  role: string
  tenantId: number | null
  userId: string
}>

export type WorkflowActor = Readonly<{
  claims: WorkflowClaims
  domain: AuditActor
  /** tenantId 用于 outbox/审计；super-admin 由调用方在加载文章后解析。 */
  tenantOf: (editionTenantId: number) => number
}>

export const workflowActorOf = (claims: WorkflowClaims): WorkflowActor => {
  const userId = parseUserId(claims.userId)
  if (!userId.ok) throw fail("EDITION_WORKFLOW_ACTOR_INVALID")
  return {
    claims,
    domain: createUserAuditActor({
      role: (claims.role === "content-service" ? "editor" : claims.role) as Parameters<
        typeof createUserAuditActor
      >[0]["role"],
      userId: userId.value,
    }),
    tenantOf: (editionTenantId) => (claims.tenantId === null ? editionTenantId : claims.tenantId),
  }
}

const serializedActor = (claims: WorkflowClaims) => ({
  kind: claims.kind,
  role: claims.role,
  tenantId: claims.tenantId,
  userId: claims.userId,
})

const parseStatus = (value: string | null): ContentEditionState => {
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
      throw fail("EDITION_WORKFLOW_STATE_INVALID")
  }
}

const scopeTenantOf = (scope: EntityScope): number | null =>
  scope.kind === "global" ? null : scope.tenantId

type VersionRow = typeof editionVersions.$inferSelect

export const loadCurrentVersion = async (
  tx: Tx,
  scope: EntityScope,
  editionId: number,
): Promise<{ root: typeof contentEditions.$inferSelect; version: VersionRow }> => {
  await tx.execute(
    sql`SELECT id FROM ${contentEditions} WHERE ${contentEditions.id} = ${editionId} FOR UPDATE`,
  )
  const rows = await tx
    .select({ root: contentEditions, version: editionVersions })
    .from(contentEditions)
    .innerJoin(
      editionVersions,
      and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
    )
    .where(eq(contentEditions.id, editionId))
    .limit(1)
  const row = rows[0]
  if (row === undefined) throw fail("EDITION_WORKFLOW_NOT_FOUND")
  const scopedTenant = scopeTenantOf(scope)
  if (scopedTenant !== null && row.version.tenantId !== scopedTenant) {
    throw fail("EDITION_WORKFLOW_TENANT_MISMATCH")
  }
  return row
}

const aggregateOf = (root: typeof contentEditions.$inferSelect, version: VersionRow) => {
  const editionId = parseEditionId(String(root.id))
  const contentId = parseContentId(String(root.id))
  const siteId = parseSiteId(String(version.siteId ?? -1))
  const tenantId = parseTenantId(String(version.tenantId ?? -1))
  if (!editionId.ok || !contentId.ok || !siteId.ok || !tenantId.ok) {
    throw fail("EDITION_WORKFLOW_ROW_INVALID")
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
    revision: Number(version.workflowRevision ?? 0),
    state: parseStatus(version.workflowStatus),
    version: 1,
  })
}

type AuditEntry = {
  action: string
  actor: ReturnType<typeof serializedActor>
  at: string
  detail?: Record<string, unknown> | undefined
  from: ContentEditionState
  reason?: string | undefined
  tenantId: number
  to: ContentEditionState
}

const appendAudit = (
  current: readonly unknown[],
  entry: Omit<AuditEntry, "actor" | "at" | "tenantId"> & {
    actor: ReturnType<typeof serializedActor>
  },
  tenantId: number,
): AuditEntry[] => [
  ...(Array.isArray(current) ? current : []),
  { ...entry, at: new Date().toISOString(), tenantId },
]

export const insertLatestVersion = async (
  tx: Tx,
  current: VersionRow,
  values: Pick<VersionRow, "auditLog" | "compiledRelease" | "workflowRevision" | "workflowStatus">,
): Promise<number> => {
  const now = new Date()
  await tx.update(editionVersions).set({ latest: false }).where(eq(editionVersions.id, current.id))
  const inserted = await tx
    .insert(editionVersions)
    .values({
      angle: current.angle,
      auditLog: values.auditLog,
      bodyMarkdown: current.bodyMarkdown,
      citations: current.citations,
      compiledRelease: values.compiledRelease,
      contentModifiedAt: current.contentModifiedAt,
      createdAt: now,
      creationOrigin: current.creationOrigin,
      dueAt: current.dueAt,
      editorialStatus: current.editorialStatus,
      entities: current.entities,
      latest: true,
      ownerId: current.ownerId,
      parentId: current.parentId,
      primaryTopic: current.primaryTopic,
      priority: current.priority,
      secondaryTopics: current.secondaryTopics,
      siteId: current.siteId,
      sites: current.sites,
      status: current.status,
      summary: current.summary,
      tenantId: current.tenantId,
      title: current.title,
      updatedAt: now,
      versionCreatedAt: current.versionCreatedAt,
      versionUpdatedAt: now,
      workflowRevision: values.workflowRevision,
      workflowStatus: values.workflowStatus,
    })
    .returning({ id: editionVersions.id })
  const versionId = inserted[0]?.id
  if (versionId === undefined) throw fail("EDITION_WORKFLOW_ROW_INVALID")
  return versionId
}

/** published/archived：把 draft 内容发布到 live 根表（Payload draft:false 语义）。 */
const publishVersionToRoot = async (
  tx: Tx,
  editionId: number,
  version: VersionRow,
  values: Pick<VersionRow, "auditLog" | "compiledRelease" | "workflowRevision" | "workflowStatus">,
): Promise<void> => {
  const now = new Date()
  // update set 的类型不接受 null；显式 sql`null` 保留"发布时清空根表可空列"的语义。
  const nn = <T>(value: T | null): T | ReturnType<typeof sql> =>
    value === null ? sql`null` : value
  await tx
    .update(contentEditions)
    .set({
      angle: nn(version.angle),
      auditLog: values.auditLog,
      bodyMarkdown: nn(version.bodyMarkdown),
      citations: nn(version.citations),
      compiledRelease: nn(values.compiledRelease),
      contentModifiedAt: nn(version.contentModifiedAt),
      creationOrigin: nn(version.creationOrigin),
      dueAt: nn(version.dueAt),
      editorialStatus: nn(version.editorialStatus),
      entities: nn(version.entities),
      ownerId: nn(version.ownerId),
      primaryTopic: nn(version.primaryTopic),
      priority: nn(version.priority),
      secondaryTopics: version.secondaryTopics,
      siteId: nn(version.siteId),
      sites: version.sites,
      status: version.status ?? "draft",
      summary: nn(version.summary),
      tenantId: nn(version.tenantId),
      title: nn(version.title),
      updatedAt: now,
      workflowRevision: values.workflowRevision,
      workflowStatus: values.workflowStatus,
    })
    .where(eq(contentEditions.id, editionId))
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/**
 * URL 预留：同 edition+site 已有 active/reserved 则复用；否则在事务内用
 * 领域 registry 校验后写入 reserved 行，unique 索引仲裁并发。
 */
export const reserveEditionUrlWithinTx = async (
  tx: Tx,
  input: Readonly<{
    editionId: number
    siteId: number
    tenantId: number
    title: string
  }>,
): Promise<number> => {
  const existing = await tx
    .select({ id: urlRecords.id })
    .from(urlRecords)
    .where(
      and(
        eq(urlRecords.editionId, input.editionId),
        eq(urlRecords.siteId, input.siteId),
        inArray(urlRecords.state, ["active", "reserved"]),
      ),
    )
    .limit(1)
  if (existing[0] !== undefined) return existing[0].id

  const siteRows = await tx
    .select({ locale: sites.locale })
    .from(sites)
    .where(eq(sites.id, input.siteId))
    .limit(1)
  const locale =
    typeof siteRows[0]?.locale === "string" && siteRows[0].locale.length > 0
      ? siteRows[0].locale
      : "en-US"
  const slug = slugify(input.title)
  const pathname = `/articles/${slug.length > 0 ? slug : `edition-${input.editionId}`}`

  const rows = await tx.select().from(urlRecords).where(eq(urlRecords.siteId, input.siteId))
  const registry = buildSiteRegistry(
    rows.map((row) =>
      toUrlRecordRow({
        canonicalUrl: row.canonicalUrl,
        content: row.editionId,
        id: row.id,
        locale: row.locale,
        pathname: row.pathname,
        revision: Number(row.revision ?? 0),
        site: row.siteId,
        state: row.state,
        statusCode: row.statusCode === null ? null : Number(row.statusCode),
        targetUrl: row.targetUrlId,
        tenant: row.tenantId,
      }),
    ),
  )
  const parsedUrlId = parseUrlId(randomUUID())
  const siteId = parseSiteId(String(input.siteId))
  const tenantId = parseTenantId(String(input.tenantId))
  const editionContentId = parseContentId(String(input.editionId))
  if (!parsedUrlId.ok || !siteId.ok || !tenantId.ok || !editionContentId.ok) {
    throw fail("URL_REGISTRY_INPUT_INVALID")
  }
  const result = reserveUrl(registry, {
    contentId: editionContentId.value,
    expectedRevision: registry.revision,
    locale,
    ownership: { scope: "site", siteId: siteId.value, tenantId: tenantId.value },
    pathname,
    urlId: parsedUrlId.value,
  })
  if (!result.ok) {
    const error = new Error(result.error.code) as Error & { code?: string }
    error.code = result.error.code
    throw error
  }
  const inserted = await tx
    .insert(urlRecords)
    .values({
      editionId: input.editionId,
      locale: result.value.reserved.locale.value,
      pathname: result.value.reserved.pathname.value,
      revision: 0,
      siteId: input.siteId,
      state: "reserved",
      tenantId: input.tenantId,
      uniqueKey: result.value.reserved.key.value,
    })
    .returning({ id: urlRecords.id })
  const id = inserted[0]?.id
  if (id === undefined) throw fail("URL_REGISTRY_INPUT_INVALID")
  return id
}

export type TransitionTxInput = Readonly<{
  actor: WorkflowActor
  compiledReleaseId?: string
  decisionId?: string
  editionId: number
  expectedRevision?: number
  idempotencyKeyHash?: string
  operationId?: string
  reason?: string
  requestId?: string
  scope: EntityScope
  target: ContentEditionState
}>

export const transitionEditionWithinTx = async (
  tx: Tx,
  input: TransitionTxInput,
): Promise<ContentEditionState> => {
  const { root, version: current } = await loadCurrentVersion(tx, input.scope, input.editionId)
  const aggregate = aggregateOf(root, current)
  if (input.expectedRevision !== undefined && input.expectedRevision !== aggregate.revision) {
    throw fail("EDITION_WORKFLOW_REVISION_CONFLICT")
  }
  const reason = input.reason?.trim()
  if (reason !== undefined && reason.length === 0) {
    throw fail("EDITION_WORKFLOW_REASON_INVALID")
  }
  const editionTenantId = current.tenantId ?? -1
  if (input.target === "approved") {
    await reserveEditionUrlWithinTx(tx, {
      editionId: input.editionId,
      siteId: current.siteId ?? -1,
      tenantId: editionTenantId,
      title: current.title ?? "",
    })
  }
  const compiledRelease =
    typeof current.compiledRelease === "string" && current.compiledRelease.length > 0
      ? current.compiledRelease
      : null
  if (input.target === "compiled" && (input.compiledReleaseId?.length ?? 0) === 0) {
    throw fail("EDITION_WORKFLOW_RELEASE_REQUIRED")
  }
  if (input.target === "published" && compiledRelease === null) {
    throw fail("EDITION_WORKFLOW_NOT_COMPILED")
  }
  const transitioned = transitionContentEdition(aggregate, input.target, {
    actor: input.actor.domain,
    clock: workflowClock,
    expectedRevision: aggregate.revision,
    qualityAssessmentState: null,
  })
  if (!transitioned.ok) {
    throw fail(transitioned.error.code)
  }
  const nextRevision = aggregate.revision + 1
  const detail = {
    ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
    ...(input.idempotencyKeyHash === undefined
      ? {}
      : { idempotencyKeyHash: input.idempotencyKeyHash }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  }
  const existingAudit: unknown[] = Array.isArray(current.auditLog) ? current.auditLog : []
  const auditLog = appendAudit(
    existingAudit,
    {
      action: `content-edition.${aggregate.state}.${input.target}`,
      actor: serializedActor(input.actor.claims),
      detail: Object.keys(detail).length > 0 ? detail : undefined,
      from: aggregate.state,
      ...(reason === undefined ? {} : { reason }),
      to: input.target,
    },
    editionTenantId,
  )
  const nextCompiledRelease =
    input.target === "compiled" && input.compiledReleaseId !== undefined
      ? input.compiledReleaseId
      : compiledRelease
  const versionValues = {
    auditLog,
    compiledRelease: nextCompiledRelease,
    workflowRevision: nextRevision,
    workflowStatus: input.target,
  }
  const newVersionId = await insertLatestVersion(tx, current, versionValues)
  if (input.target === "published" || input.target === "archived") {
    // live 根表发布语义：外部可见的终态必须落到根行，否则 API 读者仍看到旧状态。
    const fresh = await tx
      .select()
      .from(editionVersions)
      .where(eq(editionVersions.id, newVersionId))
      .limit(1)
    if (fresh[0] !== undefined) {
      await publishVersionToRoot(tx, input.editionId, fresh[0], versionValues)
    } else {
      await publishVersionToRoot(tx, input.editionId, current, versionValues)
    }
  }
  return input.target

}

export const createDraftFromPublishedWithinTx = async (
  tx: Tx,
  input: Readonly<{
    actor: WorkflowActor
    editionId: number
    reason?: string
    scope: EntityScope
  }>,
): Promise<void> => {
  const { root, version: current } = await loadCurrentVersion(tx, input.scope, input.editionId)
  const aggregate = aggregateOf(root, current)
  const drafted = createDraftEditionFromPublished(aggregate, aggregate.id, {
    actor: input.actor.domain,
    clock: workflowClock,
    expectedRevision: aggregate.revision,
  })
  if (!drafted.ok) {
    throw fail(drafted.error.code)
  }
  const reason = input.reason?.trim()
  const editionTenantId = current.tenantId ?? -1
  const existingAudit: unknown[] = Array.isArray(current.auditLog) ? current.auditLog : []
  const auditLog = appendAudit(
    existingAudit,
    {
      action: "content-edition.published.draft",
      actor: serializedActor(input.actor.claims),
      from: "published",
      ...(reason === undefined || reason.length === 0 ? {} : { reason }),
      to: "draft",
    },
    editionTenantId,
  )
  await insertLatestVersion(tx, current, {
    auditLog,
    compiledRelease: null,
    workflowRevision: 0,
    workflowStatus: "draft",
  })
}

export class WorkflowRepository {
  constructor(private readonly db: ServerDb) {}

  async transition(
    scope: EntityScope,
    input: Omit<TransitionTxInput, "scope">,
  ): Promise<ContentEditionState> {
    return this.db.transaction((tx) => transitionEditionWithinTx(tx, { ...input, scope }))
  }

  async createDraftFromPublished(
    scope: EntityScope,
    input: Readonly<{ actor: WorkflowActor; editionId: number; reason?: string }>,
  ): Promise<void> {
    await this.db.transaction((tx) => createDraftFromPublishedWithinTx(tx, { ...input, scope }))
  }
}

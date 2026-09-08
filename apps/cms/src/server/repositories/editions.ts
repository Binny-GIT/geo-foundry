/*
 * 文章 draft 只读仓储。
 *
 * Payload drafts 的物理真相不是 content_editions 根表，而是
 * _content_editions_v.latest=true。正文只读取 version_body_markdown 并实时派生
 * body，secondaryTopics/sites 从版本附表聚合；不读取 20+ 张 version block 表。
 */

import { and, asc, desc, eq, ilike, inArray, ne, sql, type SQL } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import type { ServerDb } from "../db/client"
import {
  contentEditions,
  editionVersionRels,
  editionVersions,
  editionVersionTexts,
} from "../db/edition-schema"
import { contents, sites } from "../db/entity-schema"
import { users } from "../db/schema"
import type { EntityScope, PayloadPage } from "./entities"

export type EditionListInput = Readonly<{
  ids?: readonly number[]
  limit: number
  page: number
  query?: string
  siteId?: number
  sort: "createdAt" | "title" | "updatedAt" | "-createdAt" | "-title" | "-updatedAt"
  status?: string
  tenantId?: number
}>

type EditionRoot = typeof editionVersions.$inferSelect
type EditionWorkflowStatus = Exclude<EditionRoot["workflowStatus"], null>

export type EditionDraftPatch = Readonly<{
  angle?: string
  bodyMarkdown?: string
  citations?: unknown
  content?: number
  dueAt?: string | null
  editorialStatus?: "assigned" | "blocked" | "in-progress" | "unassigned"
  entities?: unknown
  expectedUpdatedAt?: string
  owner?: number | null
  primaryTopic?: string
  priority?: "high" | "low" | "normal" | "urgent"
  secondaryTopics?: readonly string[]
  site?: number | null
  sites?: readonly number[]
  summary?: string
  tenant?: number
  title?: string
}>

export class EditionWriteError extends Error {
  override readonly name = "EditionWriteError"
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

const asDate = (value: Date | null, fallback: Date): string => (value ?? fallback).toISOString()

const pageOf = <T>(docs: readonly T[], totalDocs: number, input: EditionListInput): PayloadPage<T> => {
  const totalPages = Math.max(1, Math.ceil(totalDocs / input.limit))
  return {
    docs,
    hasNextPage: input.page < totalPages,
    hasPrevPage: input.page > 1,
    limit: input.limit,
    nextPage: input.page < totalPages ? input.page + 1 : null,
    page: input.page,
    pagingCounter: (input.page - 1) * input.limit + 1,
    prevPage: input.page > 1 ? input.page - 1 : null,
    totalDocs,
    totalPages,
  }
}

const effectiveTenant = (scope: EntityScope, requested?: number): number | null => {
  if (scope.kind === "global") return requested ?? null
  if (requested !== undefined && requested !== scope.tenantId) return -1
  return scope.tenantId
}

const sortOf = (input: EditionListInput): SQL => {
  const descending = input.sort.startsWith("-")
  const field = input.sort.replace("-", "")
  const column =
    field === "createdAt"
      ? editionVersions.versionCreatedAt
      : field === "title"
        ? editionVersions.title
        : editionVersions.versionUpdatedAt
  return (descending ? desc : asc)(column)
}

const rootPredicates = (scope: EntityScope, input: EditionListInput): SQL[] => {
  const tenantId = effectiveTenant(scope, input.tenantId)
  return [
    eq(editionVersions.latest, true),
    ...(tenantId === null ? [] : [eq(editionVersions.tenantId, tenantId)]),
    ...(input.ids === undefined ? [] : [inArray(contentEditions.id, [...input.ids])]),
    ...(input.siteId === undefined ? [] : [eq(editionVersions.siteId, input.siteId)]),
    ...(input.status === undefined
      ? []
      : [eq(editionVersions.workflowStatus, input.status as EditionWorkflowStatus)]),
    ...(input.query === undefined ? [] : [ilike(editionVersions.title, `%${input.query}%`)]),
  ]
}

const groupStrings = (
  rows: readonly Readonly<{ parentId: number; text: string | null }>[],
): Map<number, string[]> => {
  const grouped = new Map<number, string[]>()
  for (const row of rows) {
    if (row.text === null) continue
    const values = grouped.get(row.parentId) ?? []
    values.push(row.text)
    grouped.set(row.parentId, values)
  }
  return grouped
}

const groupIds = (
  rows: readonly Readonly<{ parentId: number; siteId: number | null }>[],
): Map<number, number[]> => {
  const grouped = new Map<number, number[]>()
  for (const row of rows) {
    if (row.siteId === null) continue
    const values = grouped.get(row.parentId) ?? []
    values.push(row.siteId)
    grouped.set(row.parentId, values)
  }
  return grouped
}

const dtoOf = (
  editionId: number,
  row: EditionRoot,
  secondaryTopics: readonly string[],
  sites: readonly number[],
): Record<string, unknown> => {
  const markdown = row.bodyMarkdown ?? ""
  return {
    _status: row.status ?? "draft",
    angle: row.angle ?? "",
    auditLog: Array.isArray(row.auditLog) ? row.auditLog : [],
    body: markdownToBlocks(markdown),
    bodyMarkdown: markdown,
    citations: row.citations ?? null,
    compiledRelease: row.compiledRelease ?? null,
    content: row.contentId,
    contentModifiedAt: asDate(row.contentModifiedAt, row.updatedAt),
    createdAt: asDate(row.versionCreatedAt, row.createdAt),
    creationOrigin: row.creationOrigin ?? "human",
    dueAt: row.dueAt?.toISOString() ?? null,
    editorialStatus: row.editorialStatus ?? "unassigned",
    entities: row.entities ?? null,
    id: editionId,
    owner: row.ownerId,
    primaryTopic: row.primaryTopic ?? "",
    priority: row.priority ?? "normal",
    secondaryTopics: [...secondaryTopics],
    site: row.siteId,
    sites: [...sites],
    summary: row.summary ?? "",
    tenant: row.tenantId,
    title: row.title ?? "",
    updatedAt: asDate(row.versionUpdatedAt, row.updatedAt),
    workflowRevision: Number(row.workflowRevision ?? 0),
    workflowStatus: row.workflowStatus ?? "draft",
  }
}

export class EditionsRepository {
  constructor(private readonly db: ServerDb) {}

  async listDrafts(
    scope: EntityScope,
    input: EditionListInput,
  ): Promise<PayloadPage<Record<string, unknown>>> {
    const where = and(...rootPredicates(scope, input))
    const roots = await this.db
      .select({ editionId: contentEditions.id, version: editionVersions })
      .from(contentEditions)
      .innerJoin(
        editionVersions,
        and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
      )
      .where(where)
      .orderBy(sortOf(input))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit)
    const versionIds = roots.map((row) => row.version.id)
    const [topicRows, siteRows, countRows] = await Promise.all([
      versionIds.length === 0
        ? []
        : this.db
            .select({ parentId: editionVersionTexts.parentId, text: editionVersionTexts.text })
            .from(editionVersionTexts)
            .where(
              and(
                inArray(editionVersionTexts.parentId, versionIds),
                eq(editionVersionTexts.path, "version.secondaryTopics"),
              ),
            )
            .orderBy(editionVersionTexts.order),
      versionIds.length === 0
        ? []
        : this.db
            .select({ parentId: editionVersionRels.parentId, siteId: editionVersionRels.siteId })
            .from(editionVersionRels)
            .where(
              and(
                inArray(editionVersionRels.parentId, versionIds),
                eq(editionVersionRels.path, "version.sites"),
              ),
            )
            .orderBy(editionVersionRels.order),
      this.db
        .select({ editionId: contentEditions.id })
        .from(contentEditions)
        .innerJoin(
          editionVersions,
          and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
        )
        .where(where),
    ])
    const topics = groupStrings(topicRows)
    const siteIds = groupIds(siteRows)
    return pageOf(
      roots.map(({ editionId, version }) =>
        dtoOf(editionId, version, topics.get(version.id) ?? [], siteIds.get(version.id) ?? []),
      ),
      countRows.length,
      input,
    )
  }

  async findDraft(scope: EntityScope, editionId: number): Promise<Record<string, unknown> | null> {
    const page = await this.listDrafts(scope, {
      ids: [editionId],
      limit: 1,
      page: 1,
      sort: "-updatedAt",
    })
    return page.docs[0] ?? null
  }

  async versionCount(scope: EntityScope, editionId: number): Promise<number> {
    const tenantId = effectiveTenant(scope)
    const rows = await this.db
      .select({ id: editionVersions.id })
      .from(editionVersions)
      .innerJoin(contentEditions, eq(contentEditions.id, editionVersions.parentId))
      .where(
        and(
          eq(contentEditions.id, editionId),
          ...(tenantId === null ? [] : [eq(editionVersions.tenantId, tenantId)]),
        ),
      )
    return rows.length
  }

  async createDraft(
    scope: EntityScope,
    patch: EditionDraftPatch,
  ): Promise<Record<string, unknown>> {
    let editionId: number | null = null
    await this.db.transaction(async (tx) => {
      const requestedSiteId = patch.site ?? patch.sites?.[0] ?? null
      if (requestedSiteId === null) throw new EditionWriteError("EDITION_SITE_REQUIRED", 400)
      const siteRows = await tx
        .select({ id: sites.id, tenantId: sites.tenantId })
        .from(sites)
        .where(eq(sites.id, requestedSiteId))
        .limit(1)
      const site = siteRows[0]
      if (site === undefined) throw new EditionWriteError("EDITION_SITE_NOT_FOUND", 400)
      const scopedTenant = effectiveTenant(scope)
      if (scopedTenant !== null && site.tenantId !== scopedTenant) {
        throw new EditionWriteError("TENANT_SCOPE_DENIED", 403)
      }
      if (patch.tenant !== undefined && patch.tenant !== site.tenantId) {
        throw new EditionWriteError("CMS_EDITION_TENANT_MISMATCH", 400)
      }
      const tenantId = site.tenantId
      const assignedSites = patch.sites ?? []
      if (assignedSites.length > 0) {
        const assignedRows = await tx
          .select({ id: sites.id, tenantId: sites.tenantId })
          .from(sites)
          .where(inArray(sites.id, [...assignedSites]))
        if (
          assignedRows.length !== new Set(assignedSites).size ||
          assignedRows.some((row) => row.tenantId !== tenantId)
        ) {
          throw new EditionWriteError("CMS_EDITION_TENANT_MISMATCH", 400)
        }
      }
      const ownerId = patch.owner ?? null
      if (ownerId !== null) {
        const ownerRows = await tx
          .select({ tenantId: users.tenantId })
          .from(users)
          .where(eq(users.id, ownerId))
          .limit(1)
        if (ownerRows[0]?.tenantId !== tenantId) {
          throw new EditionWriteError("CMS_EDITION_OWNER_TENANT_MISMATCH", 400)
        }
      }

      let contentId = patch.content ?? null
      if (contentId === null) {
        const createdContent = await tx
          .insert(contents)
          .values({
            createdBy: "human",
            intent: patch.angle?.trim() || patch.summary?.trim() || "draft",
            tenantId,
            topic: patch.title?.trim() || "未命名文章",
          })
          .returning({ id: contents.id })
        contentId = createdContent[0]?.id ?? null
      } else {
        const contentRows = await tx
          .select({ tenantId: contents.tenantId })
          .from(contents)
          .where(eq(contents.id, contentId))
          .limit(1)
        if (contentRows[0]?.tenantId !== tenantId) {
          throw new EditionWriteError("CMS_EDITION_TENANT_MISMATCH", 400)
        }
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${contentId}, ${requestedSiteId})`)
        const duplicate = await tx
          .select({ id: contentEditions.id })
          .from(contentEditions)
          .innerJoin(
            editionVersions,
            and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
          )
          .where(
            and(
              eq(editionVersions.contentId, contentId),
              eq(editionVersions.siteId, requestedSiteId),
            ),
          )
          .limit(1)
        if (duplicate.length > 0) throw new EditionWriteError("CMS_EDITION_SITE_DUPLICATE", 409)
      }
      if (contentId === null) throw new EditionWriteError("EDITION_CONTENT_CREATE_FAILED", 500)

      const now = new Date()
      const markdown = patch.bodyMarkdown ?? ""
      const rootRows = await tx
        .insert(contentEditions)
        .values({
          angle: patch.angle ?? "",
          auditLog: [],
          bodyMarkdown: markdown,
          citations: patch.citations ?? [],
          compiledRelease: null,
          contentId,
          contentModifiedAt: now,
          creationOrigin: "human",
          dueAt: patch.dueAt === undefined || patch.dueAt === null ? null : new Date(patch.dueAt),
          editorialStatus: patch.editorialStatus ?? "unassigned",
          entities: patch.entities ?? [],
          ownerId,
          primaryTopic: patch.primaryTopic ?? "",
          priority: patch.priority ?? "normal",
          siteId: requestedSiteId,
          status: "draft",
          summary: patch.summary ?? "",
          tenantId,
          title: patch.title ?? "",
          workflowRevision: "0",
          workflowStatus: "draft",
        })
        .returning({ id: contentEditions.id })
      editionId = rootRows[0]?.id ?? null
      if (editionId === null) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)

      const versionRows = await tx
        .insert(editionVersions)
        .values({
          angle: patch.angle ?? "",
          auditLog: [],
          bodyMarkdown: markdown,
          citations: patch.citations ?? [],
          compiledRelease: null,
          contentId,
          contentModifiedAt: now,
          creationOrigin: "human",
          dueAt: patch.dueAt === undefined || patch.dueAt === null ? null : new Date(patch.dueAt),
          editorialStatus: patch.editorialStatus ?? "unassigned",
          entities: patch.entities ?? [],
          latest: true,
          ownerId,
          parentId: editionId,
          primaryTopic: patch.primaryTopic ?? "",
          priority: patch.priority ?? "normal",
          siteId: requestedSiteId,
          status: "draft",
          summary: patch.summary ?? "",
          tenantId,
          title: patch.title ?? "",
          versionCreatedAt: now,
          versionUpdatedAt: now,
          workflowRevision: "0",
          workflowStatus: "draft",
        })
        .returning({ id: editionVersions.id })
      const versionId = versionRows[0]?.id
      if (versionId === undefined) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)
      const secondaryTopics = patch.secondaryTopics ?? []
      if (secondaryTopics.length > 0) {
        await tx.insert(editionVersionTexts).values(
          secondaryTopics.map((text, index) => ({
            order: index + 1,
            parentId: versionId,
            path: "version.secondaryTopics",
            text,
          })),
        )
      }
      if (assignedSites.length > 0) {
        await tx.insert(editionVersionRels).values(
          assignedSites.map((assignedSiteId, index) => ({
            order: index + 1,
            parentId: versionId,
            path: "version.sites",
            siteId: assignedSiteId,
          })),
        )
      }
    })
    if (editionId === null) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)
    const created = await this.findDraft(scope, editionId)
    if (created === null) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)
    return created
  }

  async saveDraft(
    scope: EntityScope,
    editionId: number,
    patch: EditionDraftPatch,
  ): Promise<Record<string, unknown>> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM ${contentEditions} WHERE ${contentEditions.id} = ${editionId} FOR UPDATE`,
      )
      const roots = await tx
        .select({ editionId: contentEditions.id, version: editionVersions })
        .from(contentEditions)
        .innerJoin(
          editionVersions,
          and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
        )
        .where(eq(contentEditions.id, editionId))
        .limit(1)
      const current = roots[0]?.version
      if (current === undefined) throw new EditionWriteError("EDITION_NOT_FOUND", 404)

      const scopedTenant = effectiveTenant(scope)
      if (scopedTenant !== null && current.tenantId !== scopedTenant) {
        throw new EditionWriteError("TENANT_SCOPE_DENIED", 403)
      }
      if (
        patch.expectedUpdatedAt !== undefined &&
        asDate(current.versionUpdatedAt, current.updatedAt) !== patch.expectedUpdatedAt
      ) {
        throw new EditionWriteError("EDITION_DRAFT_STALE", 409)
      }

      const tenantId = patch.tenant ?? current.tenantId
      const contentId = patch.content ?? current.contentId
      const siteId = patch.site === undefined ? current.siteId : patch.site
      const ownerId = patch.owner === undefined ? current.ownerId : patch.owner
      if (tenantId === null || contentId === null || siteId === null) {
        throw new EditionWriteError("EDITION_RELATION_REQUIRED", 400)
      }
      if (scopedTenant !== null && tenantId !== scopedTenant) {
        throw new EditionWriteError("TENANT_SCOPE_DENIED", 403)
      }

      const [contentRows, siteRows, ownerRows] = await Promise.all([
        tx.select({ tenantId: contents.tenantId }).from(contents).where(eq(contents.id, contentId)).limit(1),
        tx.select({ tenantId: sites.tenantId }).from(sites).where(eq(sites.id, siteId)).limit(1),
        ownerId === null
          ? Promise.resolve([])
          : tx.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, ownerId)).limit(1),
      ])
      if (contentRows[0]?.tenantId !== tenantId || siteRows[0]?.tenantId !== tenantId) {
        throw new EditionWriteError("CMS_EDITION_TENANT_MISMATCH", 400)
      }
      if (ownerId !== null && ownerRows[0]?.tenantId !== tenantId) {
        throw new EditionWriteError("CMS_EDITION_OWNER_TENANT_MISMATCH", 400)
      }

      const currentTopics = await tx
        .select({ text: editionVersionTexts.text })
        .from(editionVersionTexts)
        .where(
          and(
            eq(editionVersionTexts.parentId, current.id),
            eq(editionVersionTexts.path, "version.secondaryTopics"),
          ),
        )
        .orderBy(editionVersionTexts.order)
      const currentSites = await tx
        .select({ siteId: editionVersionRels.siteId })
        .from(editionVersionRels)
        .where(
          and(
            eq(editionVersionRels.parentId, current.id),
            eq(editionVersionRels.path, "version.sites"),
          ),
        )
        .orderBy(editionVersionRels.order)
      const secondaryTopics =
        patch.secondaryTopics ??
        currentTopics.map((row) => row.text).filter((value): value is string => value !== null)
      const assignedSites =
        patch.sites ??
        currentSites.map((row) => row.siteId).filter((value): value is number => value !== null)
      if (assignedSites.length > 0) {
        const assignedRows = await tx
          .select({ id: sites.id, tenantId: sites.tenantId })
          .from(sites)
          .where(inArray(sites.id, [...assignedSites]))
        if (
          assignedRows.length !== new Set(assignedSites).size ||
          assignedRows.some((row) => row.tenantId !== tenantId)
        ) {
          throw new EditionWriteError("CMS_EDITION_TENANT_MISMATCH", 400)
        }
      }

      const duplicate = await tx
        .select({ id: contentEditions.id })
        .from(contentEditions)
        .innerJoin(
          editionVersions,
          and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
        )
        .where(
          and(
            ne(contentEditions.id, editionId),
            eq(editionVersions.contentId, contentId),
            eq(editionVersions.siteId, siteId),
          ),
        )
        .limit(1)
      if (duplicate.length > 0) throw new EditionWriteError("CMS_EDITION_SITE_DUPLICATE", 409)

      const now = new Date()
      const same = (left: unknown, right: unknown): boolean =>
        JSON.stringify(left) === JSON.stringify(right)
      const contentChanged =
        (patch.bodyMarkdown !== undefined && patch.bodyMarkdown !== current.bodyMarkdown) ||
        (patch.citations !== undefined && !same(patch.citations, current.citations)) ||
        (patch.entities !== undefined && !same(patch.entities, current.entities)) ||
        (patch.primaryTopic !== undefined && patch.primaryTopic !== current.primaryTopic) ||
        (patch.secondaryTopics !== undefined &&
          !same(
            patch.secondaryTopics,
            currentTopics.map((row) => row.text).filter((value): value is string => value !== null),
          )) ||
        (patch.summary !== undefined && patch.summary !== current.summary) ||
        (patch.title !== undefined && patch.title !== current.title)

      await tx.update(editionVersions).set({ latest: false }).where(eq(editionVersions.id, current.id))
      const inserted = await tx
        .insert(editionVersions)
        .values({
          angle: patch.angle ?? current.angle,
          auditLog: current.auditLog,
          bodyMarkdown: patch.bodyMarkdown ?? current.bodyMarkdown,
          citations: patch.citations === undefined ? current.citations : patch.citations,
          compiledRelease: current.compiledRelease,
          contentId,
          contentModifiedAt: contentChanged ? now : current.contentModifiedAt,
          creationOrigin: current.creationOrigin,
          dueAt: patch.dueAt === undefined ? current.dueAt : patch.dueAt === null ? null : new Date(patch.dueAt),
          editorialStatus: patch.editorialStatus ?? current.editorialStatus,
          entities: patch.entities === undefined ? current.entities : patch.entities,
          latest: true,
          ownerId,
          parentId: editionId,
          primaryTopic: patch.primaryTopic ?? current.primaryTopic,
          priority: patch.priority ?? current.priority,
          siteId,
          status: current.status,
          summary: patch.summary ?? current.summary,
          tenantId,
          title: patch.title ?? current.title,
          versionCreatedAt: current.versionCreatedAt,
          versionUpdatedAt: now,
          workflowRevision: current.workflowRevision,
          workflowStatus: current.workflowStatus,
        })
        .returning({ id: editionVersions.id })
      const versionId = inserted[0]?.id
      if (versionId === undefined) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)

      if (secondaryTopics.length > 0) {
        await tx.insert(editionVersionTexts).values(
          secondaryTopics.map((text, index) => ({
            order: index + 1,
            parentId: versionId,
            path: "version.secondaryTopics",
            text,
          })),
        )
      }
      if (assignedSites.length > 0) {
        await tx.insert(editionVersionRels).values(
          assignedSites.map((assignedSiteId, index) => ({
            order: index + 1,
            parentId: versionId,
            path: "version.sites",
            siteId: assignedSiteId,
          })),
        )
      }
    })

    const saved = await this.findDraft(scope, editionId)
    if (saved === null) throw new EditionWriteError("EDITION_DRAFT_WRITE_FAILED", 500)
    return saved
  }
}

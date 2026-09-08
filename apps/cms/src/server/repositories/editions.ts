/*
 * 文章 draft 只读仓储。
 *
 * Payload drafts 的物理真相不是 content_editions 根表，而是
 * _content_editions_v.latest=true。正文只读取 version_body_markdown 并实时派生
 * body，secondaryTopics/sites 从版本附表聚合；不读取 20+ 张 version block 表。
 */

import { and, asc, desc, eq, ilike, inArray, type SQL } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import type { ServerDb } from "../db/client"
import {
  contentEditions,
  editionVersionRels,
  editionVersions,
  editionVersionTexts,
} from "../db/edition-schema"
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
}

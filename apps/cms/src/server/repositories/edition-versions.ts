/*
 * Markdown-first 文章版本仓储：历史读取与恢复完全绕过 Payload versions API。
 * 旧版本 Markdown 已经数据回填，因此这里只读取 version root + topics/sites 附表。
 */

import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import type { ServerDb } from "../db/client"
import {
  contentEditions,
  editionDraftRestoreIdempotency,
  editionVersionRels,
  editionVersions,
  editionVersionTexts,
} from "../db/edition-schema"
import { outboxEvents } from "../db/ledger-schema"
import type { EntityScope } from "./entities"

export type EditionHistoryItem = Readonly<{
  createdAt: string
  draft: boolean
  id: number
  latest: boolean
  snapshot: Readonly<{
    angle: string
    body: readonly Record<string, unknown>[]
    bodyMarkdown: string
    citations: unknown
    creationOrigin: string
    entities: unknown
    primaryTopic: string
    secondaryTopics: readonly string[]
    summary: string
    title: string
  }>
  updatedAt: string
  workflowStatus: string
}>

export type RestoreVersionInput = Readonly<{
  actor: Readonly<{
    kind: "user"
    role: string
    tenantId: number
    userId: string
  }>
  editionId: number
  expectedRevision: number
  expectedUpdatedAt: string
  idempotencyKey: string
  reason: string
  requestHash: string
  requestId: string
  uniqueKey: string
  versionId: number
}>

export type RestoreVersionResponse = Readonly<{
  editionId: number
  restoredVersionId: number
  updatedAt: string
}>

export class EditionVersionRepositoryError extends Error {
  override readonly name = "EditionVersionRepositoryError"
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

const tenantOfScope = (scope: EntityScope): number | null =>
  scope.kind === "global" ? null : scope.tenantId

const stringsByParent = (
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

export const editionHistoryItemOf = (
  row: typeof editionVersions.$inferSelect,
  secondaryTopics: readonly string[],
): EditionHistoryItem => {
  const markdown = row.bodyMarkdown ?? ""
  return {
    createdAt: row.createdAt.toISOString(),
    draft: (row.status ?? "draft") === "draft",
    id: row.id,
    latest: row.latest === true,
    snapshot: {
      angle: row.angle ?? "",
      body: markdownToBlocks(markdown),
      bodyMarkdown: markdown,
      citations: row.citations ?? null,
      creationOrigin: row.creationOrigin ?? "human",
      entities: row.entities ?? null,
      primaryTopic: row.primaryTopic ?? "",
      secondaryTopics: [...secondaryTopics],
      summary: row.summary ?? "",
      title: row.title ?? "",
    },
    updatedAt: row.updatedAt.toISOString(),
    workflowStatus: row.workflowStatus ?? "draft",
  }
}

const responseOf = (value: unknown): RestoreVersionResponse => {
  const row = value as Partial<RestoreVersionResponse> | null
  if (
    row === null ||
    typeof row.editionId !== "number" ||
    typeof row.restoredVersionId !== "number" ||
    typeof row.updatedAt !== "string"
  ) {
    throw new EditionVersionRepositoryError("EDITION_DRAFT_RESTORE_IDEMPOTENCY_INVALID", 500)
  }
  return {
    editionId: row.editionId,
    restoredVersionId: row.restoredVersionId,
    updatedAt: row.updatedAt,
  }
}

export class EditionVersionsRepository {
  constructor(private readonly db: ServerDb) {}

  async list(scope: EntityScope, editionId: number, limit = 20): Promise<readonly EditionHistoryItem[]> {
    const tenantId = tenantOfScope(scope)
    const roots = await this.db
      .select()
      .from(editionVersions)
      .where(
        and(
          eq(editionVersions.parentId, editionId),
          ...(tenantId === null ? [] : [eq(editionVersions.tenantId, tenantId)]),
        ),
      )
      .orderBy(desc(editionVersions.createdAt))
      .limit(limit)
    if (roots.length === 0) return []
    const ids = roots.map((row) => row.id)
    const topics = stringsByParent(
      await this.db
        .select({ parentId: editionVersionTexts.parentId, text: editionVersionTexts.text })
        .from(editionVersionTexts)
        .where(
          and(
            inArray(editionVersionTexts.parentId, ids),
            eq(editionVersionTexts.path, "version.secondaryTopics"),
          ),
        )
        .orderBy(editionVersionTexts.order),
    )
    return roots.map((row) => editionHistoryItemOf(row, topics.get(row.id) ?? []))
  }

  async restore(scope: EntityScope, input: RestoreVersionInput): Promise<{
    created: boolean
    response: RestoreVersionResponse
  }> {
    const tenantId = tenantOfScope(scope)
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.uniqueKey}))`)
      const existingRows = await tx
        .select({
          requestHash: editionDraftRestoreIdempotency.requestHash,
          responsePayload: editionDraftRestoreIdempotency.responsePayload,
        })
        .from(editionDraftRestoreIdempotency)
        .where(eq(editionDraftRestoreIdempotency.uniqueKey, input.uniqueKey))
        .limit(1)
      const existing = existingRows[0]
      if (existing !== undefined) {
        if (existing.requestHash !== input.requestHash) {
          throw new EditionVersionRepositoryError("IDEMPOTENCY_KEY_REUSED", 409)
        }
        await tx
          .update(editionDraftRestoreIdempotency)
          .set({
            replayCount: sql`COALESCE(${editionDraftRestoreIdempotency.replayCount}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(eq(editionDraftRestoreIdempotency.uniqueKey, input.uniqueKey))
        return { created: false, response: responseOf(existing.responsePayload) }
      }

      await tx.execute(
        sql`SELECT id FROM ${contentEditions} WHERE ${contentEditions.id} = ${input.editionId} FOR UPDATE`,
      )
      const currentRows = await tx
        .select()
        .from(editionVersions)
        .where(
          and(
            eq(editionVersions.parentId, input.editionId),
            eq(editionVersions.latest, true),
            ...(tenantId === null ? [] : [eq(editionVersions.tenantId, tenantId)]),
          ),
        )
        .limit(1)
      const current = currentRows[0]
      if (current === undefined) {
        throw new EditionVersionRepositoryError("EDITION_VERSION_NOT_FOUND", 404)
      }
      if ((current.workflowStatus ?? "draft") !== "draft") {
        throw new EditionVersionRepositoryError("EDITION_DRAFT_RESTORE_DRAFT_REQUIRED", 409)
      }
      if (Number(current.workflowRevision ?? 0) !== input.expectedRevision) {
        throw new EditionVersionRepositoryError("EDITION_WORKFLOW_REVISION_CONFLICT", 409)
      }
      if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new EditionVersionRepositoryError("EDITION_DRAFT_RESTORE_STALE", 409)
      }

      const sourceRows = await tx
        .select()
        .from(editionVersions)
        .where(
          and(
            eq(editionVersions.id, input.versionId),
            eq(editionVersions.parentId, input.editionId),
            ...(tenantId === null ? [] : [eq(editionVersions.tenantId, tenantId)]),
          ),
        )
        .limit(1)
      const source = sourceRows[0]
      if (source === undefined || source.bodyMarkdown === null) {
        throw new EditionVersionRepositoryError("EDITION_DRAFT_RESTORE_VERSION_NOT_FOUND", 404)
      }

      const [sourceTopicsRows, currentSitesRows] = await Promise.all([
        tx
          .select({ text: editionVersionTexts.text })
          .from(editionVersionTexts)
          .where(
            and(
              eq(editionVersionTexts.parentId, source.id),
              eq(editionVersionTexts.path, "version.secondaryTopics"),
            ),
          )
          .orderBy(editionVersionTexts.order),
        tx
          .select({ siteId: editionVersionRels.siteId })
          .from(editionVersionRels)
          .where(
            and(
              eq(editionVersionRels.parentId, current.id),
              eq(editionVersionRels.path, "version.sites"),
            ),
          )
          .orderBy(editionVersionRels.order),
      ])
      const sourceTopics = sourceTopicsRows
        .map((row) => row.text)
        .filter((value): value is string => value !== null)
      const currentSites = currentSitesRows
        .map((row) => row.siteId)
        .filter((value): value is number => value !== null)

      const now = new Date()
      const audit = [
        ...(Array.isArray(current.auditLog) ? current.auditLog : []),
        {
          action: "content-edition.history.draft",
          actor: input.actor,
          at: now.toISOString(),
          detail: { restoredVersionId: input.versionId },
          from: "draft",
          reason: input.reason,
          tenantId: input.actor.tenantId,
          to: "draft",
        },
      ]
      await tx.update(editionVersions).set({ latest: false }).where(eq(editionVersions.id, current.id))
      const newRows = await tx
        .insert(editionVersions)
        .values({
          angle: source.angle,
          auditLog: audit,
          bodyMarkdown: source.bodyMarkdown,
          citations: source.citations,
          compiledRelease: null,
          contentId: current.contentId,
          contentModifiedAt: now,
          createdAt: now,
          creationOrigin: source.creationOrigin,
          dueAt: current.dueAt,
          editorialStatus: current.editorialStatus,
          entities: source.entities,
          latest: true,
          ownerId: current.ownerId,
          parentId: current.parentId,
          primaryTopic: source.primaryTopic,
          priority: current.priority,
          siteId: current.siteId,
          status: current.status,
          summary: source.summary,
          tenantId: current.tenantId,
          title: source.title,
          updatedAt: now,
          versionCreatedAt: current.versionCreatedAt,
          versionUpdatedAt: now,
          workflowRevision: String(input.expectedRevision + 1),
          workflowStatus: "draft",
        })
        .returning({ id: editionVersions.id })
      const newVersionId = newRows[0]?.id
      if (newVersionId === undefined) {
        throw new EditionVersionRepositoryError("EDITION_DRAFT_WRITE_FAILED", 500)
      }
      if (sourceTopics.length > 0) {
        await tx.insert(editionVersionTexts).values(
          sourceTopics.map((text, index) => ({
            order: index + 1,
            parentId: newVersionId,
            path: "version.secondaryTopics",
            text,
          })),
        )
      }
      if (currentSites.length > 0) {
        await tx.insert(editionVersionRels).values(
          currentSites.map((siteId, index) => ({
            order: index + 1,
            parentId: newVersionId,
            path: "version.sites",
            siteId,
          })),
        )
      }
      const response: RestoreVersionResponse = {
        editionId: input.editionId,
        restoredVersionId: input.versionId,
        updatedAt: now.toISOString(),
      }
      await tx.insert(outboxEvents).values({
        aggregateId: String(input.editionId),
        aggregateType: "edition",
        attempts: "0",
        eventId: randomUUID(),
        eventPayload: {
          from: "draft",
          reason: input.reason,
          restoredVersionId: input.versionId,
          to: "draft",
          workflowRevision: input.expectedRevision + 1,
        },
        requestId: input.requestId,
        status: "pending",
        tenantId: input.actor.tenantId,
        type: "edition.draft-written",
      })
      await tx.insert(editionDraftRestoreIdempotency).values({
        actorUserId: input.actor.userId,
        editionId: input.editionId,
        endpoint: `/workspaces/editions/${input.editionId}/restore-draft`,
        idempotencyKey: input.idempotencyKey,
        replayCount: "0",
        requestHash: input.requestHash,
        requestId: input.requestId,
        responsePayload: response,
        tenantId: input.actor.tenantId,
        uniqueKey: input.uniqueKey,
        versionId: String(input.versionId),
      })
      return { created: true, response }
    })
  }
}

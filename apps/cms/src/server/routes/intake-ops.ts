/*
 * 稿源操作路由：ignore / merge / retry / adopt。
 * create 仍在旧 Payload endpoint（去重规则未迁移）。
 * adopt 用事务包住 editions+article_sources+intake 写入（旧实现无事务）。
 */

import { eq } from "drizzle-orm"
import { z } from "zod"

import { blocksToMarkdown } from "../../editor/block-markdown"
import { enqueueIntakeFetchFromEnvironment } from "../../services/intake-queue"
import { IntakeError, normalizeIntakeInput } from "../../services/intake"
import { authenticateRequest } from "../auth/session"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { articleSources, intakeItems } from "../db/session-schema"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

export class IntakeOpsError extends Error {
  override readonly name = "IntakeOpsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const statusOf = (code: string): number =>
  code === "INTAKE_ITEM_NOT_FOUND"
    ? 404
    : code === "INTAKE_TENANT_MISMATCH" ||
        code === "INTAKE_EDITOR_REQUIRED" ||
        code === "INTAKE_ACTOR_INVALID"
      ? 403
      : code === "INTAKE_MERGE_SELF_REFERENCE" || code === "INTAKE_FETCH_STATE_INVALID"
        ? 409
        : 400

const idOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[1]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

const editable = (role: string): boolean =>
  role === "editor" || role === "tenant-admin" || role === "content-service"

const loadItem = async (
  tx: Parameters<Parameters<ReturnType<typeof serverRuntime>["db"]["transaction"]>[0]>[0],
  intakeItemId: number,
  tenantId: number | null,
): Promise<typeof intakeItems.$inferSelect> => {
  const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, intakeItemId)).limit(1)
  const item = rows[0]
  if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
  if (tenantId !== null && item.tenantId !== tenantId) {
    throw new IntakeOpsError("INTAKE_TENANT_MISMATCH")
  }
  return item
}

const rowOf = (item: typeof intakeItems.$inferSelect): Record<string, unknown> => ({
  channel: item.channel,
  contentHash: item.contentHash,
  duplicateOf: item.duplicateOfId,
  duplicateStatus: item.duplicateStatus,
  failureCode: item.failureCode,
  failureReason: item.failureReason,
  id: item.id,
  mergedInto: item.mergedIntoId,
  sourceUrl: item.sourceUrl,
  status: item.status,
  suggestedSite: item.suggestedSiteId,
  summary: item.summary,
  tenant: item.tenantId,
  title: item.title,
})

const mergeSchema = z.object({ targetIntakeItemId: z.coerce.number().int().positive() }).strict()
const adoptSchema = z.object({ siteId: z.coerce.number().int().positive().optional() }).strict()

export const intakeOpsActionOf = (
  slug: readonly string[] | undefined,
): "create" | "ignore" | "merge" | "retry" | "adopt" | null => {
  if (slug?.length === 1 && slug[0] === "intake-operations") return "create"
  if (slug?.length !== 3 || slug[0] !== "intake-operations") return null
  if (slug[2] === "ignore" || slug[2] === "merge" || slug[2] === "retry" || slug[2] === "adopt") {
    return slug[2]
  }
  return null
}

export const handleIntakeOpsPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const action = intakeOpsActionOf(slug)
  if (action === null) return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "INTAKE_UNAUTHENTICATED" } })
  if (!editable(auth.claims.role)) return json(403, { error: { code: "INTAKE_EDITOR_REQUIRED" } })
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { error: { code: "INTAKE_ACTOR_INVALID" } })
  const tenantId = scope.kind === "global" ? null : scope.tenantId
  const itemId = action === "create" ? 0 : (idOf(slug) ?? 0)
  if (action !== "create" && itemId === 0) {
    return json(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
  }

  let raw: unknown = {}
  if (action === "merge" || action === "adopt") {
    try {
      raw = await request.json()
    } catch {
      return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
    }
  }

  const db = serverRuntime().db
  try {
    if (action === "create") {
      try {
        raw = await request.json()
      } catch {
        return json(400, { error: { code: "INTAKE_CREATE_BODY_INVALID" } })
      }
      const createSchema = z
        .object({
          channel: z.enum(["manual", "url", "webhook", "rss"]),
          connectorId: z.coerce.number().int().positive().optional(),
          contentHash: z.string().trim().min(1).max(512).optional(),
          sourceUrl: z.string().trim().min(1).max(4_000).optional(),
          suggestedSiteId: z.coerce.number().int().positive().optional(),
          summary: z.string().trim().min(1).max(20_000).optional(),
          title: z.string().trim().min(1).max(1_000),
        })
        .strict()
      const parsed = createSchema.safeParse(raw)
      const tenantId = scope.kind === "global" ? null : scope.tenantId
      if (!parsed.success || tenantId === null) {
        return json(400, { error: { code: "INTAKE_CREATE_BODY_INVALID" } })
      }
      try {
        const normalized = normalizeIntakeInput({
          channel: parsed.data.channel,
          ...(parsed.data.connectorId === undefined
            ? {}
            : { connectorId: parsed.data.connectorId }),
          ...(parsed.data.contentHash === undefined
            ? {}
            : { contentHash: parsed.data.contentHash }),
          ...(parsed.data.sourceUrl === undefined ? {} : { sourceUrl: parsed.data.sourceUrl }),
          ...(parsed.data.suggestedSiteId === undefined
            ? {}
            : { suggestedSiteId: parsed.data.suggestedSiteId }),
          ...(parsed.data.summary === undefined ? {} : { summary: parsed.data.summary }),
          tenantId,
          title: parsed.data.title,
        })
        const result = await db.transaction(async (tx) => {
          const lowerTitle = normalized.title.trim().replace(/\s+/g, " ").toLocaleLowerCase()
          const candidates = await tx
            .select()
            .from(intakeItems)
            .where(eq(intakeItems.tenantId, tenantId))
            .limit(500)
          const duplicates = candidates.filter(
            (item) =>
              (normalized.normalizedUrl !== undefined &&
                item.normalizedUrl === normalized.normalizedUrl) ||
              (normalized.contentHash !== undefined &&
                item.contentHash === normalized.contentHash) ||
              (item.title ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase() === lowerTitle,
          )
          const duplicateOf = duplicates[0]
          const inserted = await tx
            .insert(intakeItems)
            .values({
              channel: normalized.channel,
              ...(normalized.connectorId === undefined
                ? {}
                : { connectorId: normalized.connectorId }),
              ...(normalized.contentHash === undefined
                ? {}
                : { contentHash: normalized.contentHash }),
              ...(duplicateOf === undefined ? {} : { duplicateOfId: duplicateOf.id }),
              duplicateStatus: duplicateOf === undefined ? "unique" : "duplicate",
              ...(normalized.normalizedUrl === undefined
                ? {}
                : { normalizedUrl: normalized.normalizedUrl }),
              ...(normalized.sourceUrl === undefined ? {} : { sourceUrl: normalized.sourceUrl }),
              ...(normalized.suggestedSiteId === undefined
                ? {}
                : { suggestedSiteId: normalized.suggestedSiteId }),
              ...(normalized.summary === undefined ? {} : { summary: normalized.summary }),
              status: duplicateOf === undefined ? "new" : "duplicate",
              tenantId,
              title: normalized.title,
            })
            .returning()
          const item = inserted[0]
          if (item === undefined) throw new IntakeOpsError("INTAKE_CREATE_FAILED")
          return { duplicates, item }
        })
        const shouldFetch =
          result.duplicates.length === 0 &&
          (parsed.data.channel === "url" || parsed.data.channel === "rss")
        if (!shouldFetch) {
          return json(result.duplicates.length === 0 ? 201 : 200, {
            duplicateIds: result.duplicates.map((item) => item.id),
            fetchQueued: false,
            intakeItem: rowOf(result.item),
          })
        }
        try {
          await enqueueIntakeFetchFromEnvironment({
            intakeItemId: result.item.id,
            tenantId: result.item.tenantId,
          })
          await db
            .update(intakeItems)
            .set({ status: "fetching", updatedAt: new Date() })
            .where(eq(intakeItems.id, result.item.id))
          return json(201, {
            duplicateIds: [],
            fetchQueued: true,
            intakeItem: rowOf({ ...result.item, status: "fetching" }),
          })
        } catch {
          await db
            .update(intakeItems)
            .set({
              failureCode: "INTAKE_QUEUE_UNAVAILABLE",
              failureReason:
                "The fetch task could not be queued. Retry this intake item when the worker is available.",
              status: "new",
              updatedAt: new Date(),
            })
            .where(eq(intakeItems.id, result.item.id))
          return json(202, {
            duplicateIds: [],
            fetchQueued: false,
            intakeItem: rowOf({ ...result.item, status: "new" }),
          })
        }
      } catch (error) {
        if (error instanceof IntakeError) {
          return json(statusOf(error.code), { error: { code: error.code } })
        }
        throw error
      }
    }

    if (action === "ignore") {
      const item = await db.transaction(async (tx) => {
        await loadItem(tx, itemId, tenantId)
        await tx
          .update(intakeItems)
          .set({ status: "ignored", updatedAt: new Date() })
          .where(eq(intakeItems.id, itemId))
        const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, itemId)).limit(1)
        return rows[0]
      })
      if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
      return json(200, { intakeItem: rowOf(item) })
    }

    if (action === "merge") {
      const parsed = mergeSchema.safeParse(raw)
      if (!parsed.success) return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
      if (itemId === parsed.data.targetIntakeItemId) {
        throw new IntakeOpsError("INTAKE_MERGE_SELF_REFERENCE")
      }
      const item = await db.transaction(async (tx) => {
        await loadItem(tx, itemId, tenantId)
        await loadItem(tx, parsed.data.targetIntakeItemId, tenantId)
        await tx
          .update(intakeItems)
          .set({
            duplicateOfId: parsed.data.targetIntakeItemId,
            duplicateStatus: "duplicate",
            mergedIntoId: parsed.data.targetIntakeItemId,
            status: "merged",
            updatedAt: new Date(),
          })
          .where(eq(intakeItems.id, itemId))
        const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, itemId)).limit(1)
        return rows[0]
      })
      if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
      return json(200, { intakeItem: rowOf(item) })
    }

    if (action === "retry") {
      const item = await db.transaction(async (tx) => {
        const loaded = await loadItem(tx, itemId, tenantId)
        if (loaded.channel !== "url" && loaded.channel !== "rss") {
          throw new IntakeOpsError("INTAKE_FETCH_CHANNEL_INVALID")
        }
        if (loaded.status !== "new" && loaded.status !== "failed") {
          throw new IntakeOpsError("INTAKE_FETCH_STATE_INVALID")
        }
        return loaded
      })
      await enqueueIntakeFetchFromEnvironment({ intakeItemId: item.id, tenantId: item.tenantId })
      await db
        .update(intakeItems)
        .set({ failureCode: null, failureReason: null, status: "fetching", updatedAt: new Date() })
        .where(eq(intakeItems.id, item.id))
      const rows = await db.select().from(intakeItems).where(eq(intakeItems.id, item.id)).limit(1)
      return json(202, { intakeItem: rowOf(rows[0] ?? item) })
    }

    const parsed = adoptSchema.safeParse(raw)
    if (!parsed.success) return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
    if (auth.claims.role === "content-service") {
      throw new IntakeOpsError("INTAKE_EDITOR_REQUIRED")
    }
    const result = await db.transaction(async (tx) => {
      const item = await loadItem(tx, itemId, tenantId)
      const siteId = parsed.data.siteId ?? item.suggestedSiteId ?? null
      if (siteId === null) throw new IntakeOpsError("INTAKE_ADOPTION_SITE_REQUIRED")
      const siteRows = await tx
        .select({ tenantId: sites.tenantId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1)
      const siteTenant = siteRows[0]?.tenantId
      if (siteTenant === undefined || siteTenant !== item.tenantId) {
        throw new IntakeOpsError("INTAKE_TENANT_MISMATCH")
      }
      const title = item.title ?? "Untitled intake"
      const summary = item.summary ?? title
      const blocks = Array.isArray(item.contentBlocks)
        ? (item.contentBlocks as unknown[]).filter(
            (block): block is Record<string, unknown> =>
              typeof block === "object" &&
              block !== null &&
              typeof (block as Record<string, unknown>)["blockType"] === "string",
          )
        : []
      const markdown = blocks.length > 0 ? blocksToMarkdown(blocks) : summary
      const citations =
        item.sourceUrl === null || item.sourceUrl === undefined
          ? []
          : [{ id: `intake-${item.id}`, title, url: item.sourceUrl }]
      const now = new Date()
      const rootRows = await tx
        .insert(contentEditions)
        .values({
          angle: title,
          auditLog: [],
          bodyMarkdown: markdown,
          citations,
          compiledRelease: null,
          contentModifiedAt: now,
          creationOrigin: "human",
          editorialStatus: "unassigned",
          entities: [],
          ownerId: null,
          primaryTopic: title,
          secondaryTopics: [],
          priority: "normal",
          siteId,
          sites: [siteId],
          status: "draft",
          summary,
          tenantId: item.tenantId,
          title,
          workflowRevision: 0,
          workflowStatus: "draft",
        })
        .returning({ id: contentEditions.id })
      const editionId = rootRows[0]?.id
      if (editionId === undefined) throw new IntakeOpsError("INTAKE_ADOPTION_FAILED")
      const versionRows = await tx
        .insert(editionVersions)
        .values({
          angle: title,
          auditLog: [],
          bodyMarkdown: markdown,
          citations,
          compiledRelease: null,
          contentModifiedAt: now,
          creationOrigin: "human",
          editorialStatus: "unassigned",
          entities: [],
          latest: true,
          ownerId: null,
          parentId: editionId,
          primaryTopic: title,
          secondaryTopics: [],
          priority: "normal",
          siteId,
          sites: [siteId],
          status: "draft",
          summary,
          tenantId: item.tenantId,
          title,
          versionCreatedAt: now,
          versionUpdatedAt: now,
          workflowRevision: 0,
          workflowStatus: "draft",
        })
        .returning({ id: editionVersions.id })
      if (versionRows[0]?.id === undefined) throw new IntakeOpsError("INTAKE_ADOPTION_FAILED")
      await tx.insert(articleSources).values({
        editionId,
        intakeItemId: item.id,
        note: summary,
        role: "primary",
        tenantId: item.tenantId,
      })
      await tx
        .update(intakeItems)
        .set({ adoptedEditionId: editionId, status: "adopted", updatedAt: new Date() })
        .where(eq(intakeItems.id, item.id))
      return { editionId, intakeItem: item }
    })
    return json(200, {
      editionId: result.editionId,
      intakeItem: rowOf(result.intakeItem),
      sourceLinked: true,
      sourceLinkStatus: "created",
    })
  } catch (error) {
    const code = error instanceof IntakeOpsError ? error.code : "INTAKE_OPS_FAILED"
    return json(statusOf(code), { error: { code } })
  }
}

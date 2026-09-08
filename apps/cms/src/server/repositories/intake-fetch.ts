/*
 * Worker 抓取链路（claim / input / complete / fail / rss-entries）的 Drizzle
 * 实现。错误仍抛 IntakeError，internal guards 的状态码映射不变。
 * 与旧 services/intake-fetch.ts 的差异：快照与稿源状态写入同一事务；
 * RSS 子项去重用一次 IN 查询而非逐条 find。
 */

import { and, eq, inArray, or } from "drizzle-orm"

import { resolveSessionClaims } from "../../access/session"
import { IntakeError, normalizeIntakeInput, normalizeIntakeUrl } from "../../services/intake"
import type { ServerDb } from "../db/client"
import { connectors, sourceSnapshots } from "../db/entity-schema"
import { intakeItems } from "../db/session-schema"

type Tx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]
type IntakeRow = typeof intakeItems.$inferSelect

const fail = (code: string, detail?: string): IntakeError => new IntakeError(code, detail)

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length === 0 ? null : normalized
}

const requireService = (user: unknown, tenantId: number): void => {
  const claims = resolveSessionClaims(user)
  if (
    claims === null ||
    claims.kind !== "service" ||
    claims.role !== "content-service" ||
    String(claims.tenantId) !== String(tenantId)
  ) {
    throw fail("INTAKE_TENANT_MISMATCH")
  }
}

const loadIntake = async (tx: Tx, intakeItemId: number, user: unknown): Promise<IntakeRow> => {
  const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, intakeItemId)).limit(1)
  const item = rows[0]
  if (item === undefined) throw fail("INTAKE_ITEM_NOT_FOUND", String(intakeItemId))
  requireService(user, item.tenantId)
  return item
}

type SnapshotInput = Readonly<{
  contentHash: string
  contentLength: number
  contentType: string
  intakeItemId: number
  kind: "extracted-content" | "raw-response"
  storageKey: string
  tenantId: number
}>

/** storage_key 是不可变快照身份：同 key 再报必须完全一致，否则冲突。 */
const snapshotIdFor = async (tx: Tx, input: SnapshotInput): Promise<number> => {
  const existing = await tx
    .select({
      contentHash: sourceSnapshots.contentHash,
      contentLength: sourceSnapshots.contentLength,
      contentType: sourceSnapshots.contentType,
      id: sourceSnapshots.id,
    })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.storageKey, input.storageKey))
    .limit(1)
  const prior = existing[0]
  if (prior !== undefined) {
    if (
      prior.contentHash !== input.contentHash ||
      Number(prior.contentLength) !== input.contentLength ||
      prior.contentType !== input.contentType
    ) {
      throw fail("INTAKE_SNAPSHOT_CONFLICT", input.storageKey)
    }
    return prior.id
  }
  const inserted = await tx
    .insert(sourceSnapshots)
    .values({
      capturedAt: new Date(),
      contentHash: input.contentHash,
      contentLength: input.contentLength,
      contentType: input.contentType,
      intakeItemId: input.intakeItemId,
      kind: input.kind,
      storageKey: input.storageKey,
      tenantId: input.tenantId,
    })
    .returning({ id: sourceSnapshots.id })
  const id = inserted[0]?.id
  if (id === undefined) throw fail("INTAKE_SNAPSHOT_INVALID", input.storageKey)
  return id
}

export const claimIntakeFetch = async (
  db: ServerDb,
  intakeItemId: number,
  user: unknown,
): Promise<void> =>
  db.transaction(async (tx) => {
    const item = await loadIntake(tx, intakeItemId, user)
    if (item.status === "fetching") return
    if (item.status !== "new") throw fail("INTAKE_FETCH_STATE_INVALID", String(item.status))
    await tx
      .update(intakeItems)
      .set({ failureCode: null, failureReason: null, status: "fetching", updatedAt: new Date() })
      .where(eq(intakeItems.id, item.id))
  })

export type IntakeFetchInput = Readonly<{
  channel: "rss" | "url"
  connectorId?: number
  intakeItemId: number
  sourceUrl: string
  tenantId: number
}>

export const readIntakeFetchInput = async (
  db: ServerDb,
  intakeItemId: number,
  user: unknown,
): Promise<IntakeFetchInput> =>
  db.transaction(async (tx) => {
    const item = await loadIntake(tx, intakeItemId, user)
    if (item.status !== "new" && item.status !== "fetching") {
      throw fail("INTAKE_FETCH_STATE_INVALID", String(item.status))
    }
    if (item.channel !== "url" && item.channel !== "rss") {
      throw fail("INTAKE_FETCH_CHANNEL_INVALID", String(item.channel))
    }
    if (item.channel === "url") {
      const sourceUrl = normalizeIntakeUrl(
        text(item.normalizedUrl) ?? text(item.sourceUrl) ?? undefined,
      )
      if (sourceUrl === undefined) throw fail("INTAKE_SOURCE_URL_REQUIRED")
      return { channel: "url", intakeItemId: item.id, sourceUrl, tenantId: item.tenantId }
    }
    if (item.connectorId === null) throw fail("INTAKE_CONNECTOR_REQUIRED")
    const connectorRows = await tx
      .select()
      .from(connectors)
      .where(eq(connectors.id, item.connectorId))
      .limit(1)
    const connector = connectorRows[0]
    if (
      connector === undefined ||
      connector.tenantId !== item.tenantId ||
      connector.type !== "rss" ||
      connector.status !== "active"
    ) {
      throw fail("INTAKE_CONNECTOR_INVALID", String(item.connectorId))
    }
    const sourceUrl = normalizeIntakeUrl(text(connector.sourceEndpoint) ?? undefined)
    if (sourceUrl === undefined) throw fail("INTAKE_SOURCE_URL_REQUIRED")
    return {
      channel: "rss",
      connectorId: connector.id,
      intakeItemId: item.id,
      sourceUrl,
      tenantId: item.tenantId,
    }
  })

export type IntakeFetchCompletion = Readonly<{
  contentBlocks?: readonly Record<string, unknown>[] | undefined
  extracted: Readonly<{
    contentHash: string
    contentLength: number
    contentType: string
    storageKey: string
  }>
  intakeItemId: number
  raw: Readonly<{
    contentHash: string
    contentLength: number
    contentType: string
    storageKey: string
  }>
  summary: string
  title: string
}>

export const completeIntakeFetch = async (
  db: ServerDb,
  input: IntakeFetchCompletion,
  user: unknown,
): Promise<{ readonly intakeItemId: number; readonly snapshotId: number }> =>
  db.transaction(async (tx) => {
    const item = await loadIntake(tx, input.intakeItemId, user)
    if (item.status !== "fetching" && item.status !== "ready") {
      throw fail("INTAKE_FETCH_STATE_INVALID", String(item.status))
    }
    await snapshotIdFor(tx, {
      ...input.raw,
      intakeItemId: item.id,
      kind: "raw-response",
      tenantId: item.tenantId,
    })
    const extractedSnapshotId = await snapshotIdFor(tx, {
      ...input.extracted,
      intakeItemId: item.id,
      kind: "extracted-content",
      tenantId: item.tenantId,
    })
    await tx
      .update(intakeItems)
      .set({
        contentBlocks: input.contentBlocks === undefined ? [] : [...input.contentBlocks],
        contentHash: input.extracted.contentHash,
        failureCode: null,
        failureReason: null,
        snapshotId: extractedSnapshotId,
        status: "ready",
        summary: input.summary,
        title: input.title,
        updatedAt: new Date(),
      })
      .where(eq(intakeItems.id, item.id))
    return { intakeItemId: item.id, snapshotId: extractedSnapshotId }
  })

export const failIntakeFetch = async (
  db: ServerDb,
  input: Readonly<{ code: string; intakeItemId: number; reason: string }>,
  user: unknown,
): Promise<void> =>
  db.transaction(async (tx) => {
    const item = await loadIntake(tx, input.intakeItemId, user)
    if (item.status !== "new" && item.status !== "fetching" && item.status !== "failed") {
      throw fail("INTAKE_FETCH_STATE_INVALID", String(item.status))
    }
    await tx
      .update(intakeItems)
      .set({
        failureCode: input.code.slice(0, 120),
        failureReason: input.reason.slice(0, 500),
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(intakeItems.id, item.id))
  })

export type RssIntakeEntry = Readonly<{
  sourceUrl: string
  summary?: string
  title: string
}>

const normalizedTitle = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase()

/**
 * RSS 抓取结果 → 同 connector 下的 URL 稿源。租户内已存在同 normalizedUrl
 * 的条目整体跳过（定时重抓不累积重复行）；其余按 URL / 标题 / hash 判重，
 * 与会话侧 intake create 的规则一致。
 */
export const createRssIntakeEntries = async (
  db: ServerDb,
  input: Readonly<{ entries: readonly RssIntakeEntry[]; intakeItemId: number }>,
  user: unknown,
): Promise<readonly number[]> =>
  db.transaction(async (tx) => {
    const parent = await loadIntake(tx, input.intakeItemId, user)
    if (parent.connectorId === null) throw fail("INTAKE_CONNECTOR_REQUIRED")
    if (parent.channel !== "rss") throw fail("INTAKE_FETCH_CHANNEL_INVALID", String(parent.channel))
    const tenantId = parent.tenantId
    const bounded = input.entries.slice(0, 20)
    const normalizedUrls = [
      ...new Set(bounded.flatMap((entry) => normalizeIntakeUrl(entry.sourceUrl) ?? [])),
    ]
    const knownRows =
      normalizedUrls.length === 0
        ? []
        : await tx
            .select({ normalizedUrl: intakeItems.normalizedUrl })
            .from(intakeItems)
            .where(
              and(
                eq(intakeItems.tenantId, tenantId),
                inArray(intakeItems.normalizedUrl, normalizedUrls),
              ),
            )
    const knownUrls = new Set(
      knownRows.flatMap((row) =>
        typeof row.normalizedUrl === "string" ? [row.normalizedUrl] : [],
      ),
    )
    const created: number[] = []
    for (const entry of bounded) {
      const normalizedUrl = normalizeIntakeUrl(entry.sourceUrl)
      if (normalizedUrl !== undefined && knownUrls.has(normalizedUrl)) continue
      const normalized = normalizeIntakeInput({
        channel: "url",
        connectorId: parent.connectorId,
        sourceUrl: entry.sourceUrl,
        ...(parent.suggestedSiteId === null ? {} : { suggestedSiteId: parent.suggestedSiteId }),
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        tenantId,
        title: entry.title,
      })
      const conditions = [
        eq(intakeItems.title, normalized.title),
        ...(normalized.normalizedUrl === undefined
          ? []
          : [eq(intakeItems.normalizedUrl, normalized.normalizedUrl)]),
        ...(normalized.contentHash === undefined
          ? []
          : [eq(intakeItems.contentHash, normalized.contentHash)]),
      ]
      const candidates = await tx
        .select()
        .from(intakeItems)
        .where(and(eq(intakeItems.tenantId, tenantId), or(...conditions)))
        .limit(100)
      const expectedTitle = normalizedTitle(normalized.title)
      const duplicates = candidates.filter(
        (row) =>
          (normalized.normalizedUrl !== undefined &&
            row.normalizedUrl === normalized.normalizedUrl) ||
          (normalized.contentHash !== undefined && row.contentHash === normalized.contentHash) ||
          normalizedTitle(row.title) === expectedTitle,
      )
      const duplicateOf = duplicates[0]
      const inserted = await tx
        .insert(intakeItems)
        .values({
          channel: "url",
          connectorId: parent.connectorId,
          ...(normalized.contentHash === undefined ? {} : { contentHash: normalized.contentHash }),
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
        .returning({ id: intakeItems.id })
      const id = inserted[0]?.id
      if (id === undefined) throw fail("INTAKE_CREATE_FAILED")
      if (duplicates.length === 0) {
        created.push(id)
        if (normalizedUrl !== undefined) knownUrls.add(normalizedUrl)
      }
    }
    return created
  })

import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { IntakeError, createIntakeItem, normalizeIntakeUrl } from "./intake"

type IntakeId = number

type Reference = { readonly id?: unknown }

type IntakeDoc = Readonly<{
  readonly id: IntakeId
  readonly channel: unknown
  readonly connector?: unknown
  readonly normalizedUrl?: unknown
  readonly sourceUrl?: unknown
  readonly status?: unknown
  readonly suggestedSite?: unknown
  readonly tenant: unknown
}>

type ConnectorDoc = Readonly<{
  readonly id: IntakeId
  readonly sourceEndpoint?: unknown
  readonly status?: unknown
  readonly tenant: unknown
  readonly type?: unknown
}>

const idOf = (value: unknown): IntakeId | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  if (typeof value === "object" && value !== null) return idOf((value as Reference).id)
  return null
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length === 0 ? null : normalized
}

const requireService = (user: unknown, tenantId: IntakeId): void => {
  const claims = resolveSessionClaims(user)
  if (
    claims === null ||
    claims.kind !== "service" ||
    claims.role !== "content-service" ||
    String(claims.tenantId) !== String(tenantId)
  ) {
    throw new IntakeError("INTAKE_TENANT_MISMATCH")
  }
}

const loadIntake = async (payload: Payload, intakeItemId: IntakeId): Promise<IntakeDoc> => {
  try {
    return (await payload.findByID({
      collection: "intake-items",
      depth: 0,
      id: intakeItemId,
      overrideAccess: true,
    })) as unknown as IntakeDoc
  } catch (error) {
    if ((error as { status?: unknown }).status === 404) {
      throw new IntakeError("INTAKE_ITEM_NOT_FOUND", String(intakeItemId))
    }
    throw error
  }
}

const loadConnector = async (payload: Payload, connectorId: IntakeId): Promise<ConnectorDoc> =>
  (await payload.findByID({
    collection: "connectors",
    depth: 0,
    id: connectorId,
    overrideAccess: true,
  })) as unknown as ConnectorDoc

const snapshotIdFor = async (
  payload: Payload,
  input: {
    readonly contentHash: string
    readonly contentLength: number
    readonly contentType: string
    readonly intakeItemId: IntakeId
    readonly kind: "extracted-content" | "raw-response"
    readonly storageKey: string
    readonly tenantId: IntakeId
  },
): Promise<IntakeId> => {
  const existing = await payload.find({
    collection: "source-snapshots",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { storageKey: { equals: input.storageKey } },
  })
  const prior = existing.docs[0] as
    | { contentHash?: unknown; contentLength?: unknown; contentType?: unknown; id?: unknown }
    | undefined
  if (prior !== undefined) {
    if (
      prior.contentHash !== input.contentHash ||
      prior.contentLength !== input.contentLength ||
      prior.contentType !== input.contentType
    ) {
      throw new IntakeError("INTAKE_SNAPSHOT_CONFLICT", input.storageKey)
    }
    const existingId = idOf(prior.id)
    if (existingId === null) throw new IntakeError("INTAKE_SNAPSHOT_INVALID", input.storageKey)
    return existingId
  }
  const created = await payload.create({
    collection: "source-snapshots",
    data: {
      capturedAt: new Date().toISOString(),
      contentHash: input.contentHash,
      contentLength: input.contentLength,
      contentType: input.contentType,
      intakeItem: input.intakeItemId,
      kind: input.kind,
      storageKey: input.storageKey,
      tenant: input.tenantId,
    },
    depth: 0,
    overrideAccess: true,
  })
  const createdId = idOf(created.id)
  if (createdId === null) throw new IntakeError("INTAKE_SNAPSHOT_INVALID", input.storageKey)
  return createdId
}

/** Claims queued URL/RSS work immediately before the Worker starts network I/O. */
export const claimIntakeFetch = async (
  payload: Payload,
  intakeItemId: IntakeId,
  user: unknown,
): Promise<void> => {
  const item = await loadIntake(payload, intakeItemId)
  const tenantId = idOf(item.tenant)
  if (tenantId === null) throw new IntakeError("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  requireService(user, tenantId)
  if (item.status === "fetching") return
  if (item.status !== "new") throw new IntakeError("INTAKE_FETCH_STATE_INVALID", String(item.status))
  await payload.update({
    collection: "intake-items",
    data: { failureCode: null, failureReason: null, status: "fetching" },
    depth: 0,
    draft: true,
    id: item.id,
    overrideAccess: true,
  })
}

export type IntakeFetchInput = Readonly<{
  readonly channel: "rss" | "url"
  readonly connectorId?: IntakeId
  readonly intakeItemId: IntakeId
  readonly sourceUrl: string
  readonly tenantId: IntakeId
}>

/** Loads one tenant-scoped fetch request for the Worker without exposing database access. */
export const readIntakeFetchInput = async (
  payload: Payload,
  intakeItemId: IntakeId,
  user: unknown,
): Promise<IntakeFetchInput> => {
  const item = await loadIntake(payload, intakeItemId)
  const tenantId = idOf(item.tenant)
  if (tenantId === null) throw new IntakeError("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  requireService(user, tenantId)
  if (item.status !== "new" && item.status !== "fetching") {
    throw new IntakeError("INTAKE_FETCH_STATE_INVALID", String(item.status))
  }
  if (item.channel !== "url" && item.channel !== "rss") {
    throw new IntakeError("INTAKE_FETCH_CHANNEL_INVALID", String(item.channel))
  }
  if (item.channel === "url") {
    const sourceUrl = normalizeIntakeUrl(text(item.normalizedUrl) ?? text(item.sourceUrl) ?? undefined)
    if (sourceUrl === undefined) throw new IntakeError("INTAKE_SOURCE_URL_REQUIRED")
    return { channel: "url", intakeItemId: item.id, sourceUrl, tenantId }
  }

  const connectorId = idOf(item.connector)
  if (connectorId === null) throw new IntakeError("INTAKE_CONNECTOR_REQUIRED")
  const connector = await loadConnector(payload, connectorId)
  if (
    String(idOf(connector.tenant)) !== String(tenantId) ||
    connector.type !== "rss" ||
    connector.status !== "active"
  ) {
    throw new IntakeError("INTAKE_CONNECTOR_INVALID", String(connectorId))
  }
  const sourceUrl = normalizeIntakeUrl(text(connector.sourceEndpoint) ?? undefined)
  if (sourceUrl === undefined) throw new IntakeError("INTAKE_SOURCE_URL_REQUIRED")
  return { channel: "rss", connectorId, intakeItemId: item.id, sourceUrl, tenantId }
}

export type IntakeFetchCompletion = Readonly<{
  readonly contentBlocks?: readonly Record<string, unknown>[] | undefined
  readonly extracted: {
    readonly contentHash: string
    readonly contentLength: number
    readonly contentType: string
    readonly storageKey: string
  }
  readonly intakeItemId: IntakeId
  readonly raw: {
    readonly contentHash: string
    readonly contentLength: number
    readonly contentType: string
    readonly storageKey: string
  }
  readonly summary: string
  readonly title: string
}>

/** Stores immutable snapshot metadata and makes a fetched item ready for editorial review. */
export const completeIntakeFetch = async (
  payload: Payload,
  input: IntakeFetchCompletion,
  user: unknown,
): Promise<{ readonly intakeItemId: IntakeId; readonly snapshotId: IntakeId }> => {
  const item = await loadIntake(payload, input.intakeItemId)
  const tenantId = idOf(item.tenant)
  if (tenantId === null) throw new IntakeError("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  requireService(user, tenantId)
  if (item.status !== "fetching" && item.status !== "ready") {
    throw new IntakeError("INTAKE_FETCH_STATE_INVALID", String(item.status))
  }
  const rawSnapshotId = await snapshotIdFor(payload, {
    ...input.raw,
    intakeItemId: item.id,
    kind: "raw-response",
    tenantId,
  })
  void rawSnapshotId
  const extractedSnapshotId = await snapshotIdFor(payload, {
    ...input.extracted,
    intakeItemId: item.id,
    kind: "extracted-content",
    tenantId,
  })
  await payload.update({
    collection: "intake-items",
    data: {
      contentBlocks: input.contentBlocks ? [...input.contentBlocks] : [],
      contentHash: input.extracted.contentHash,
      failureCode: null,
      failureReason: null,
      snapshot: extractedSnapshotId,
      status: "ready",
      summary: input.summary,
      title: input.title,
    },
    depth: 0,
    draft: true,
    id: item.id,
    overrideAccess: true,
  })
  return { intakeItemId: item.id, snapshotId: extractedSnapshotId }
}

export const failIntakeFetch = async (
  payload: Payload,
  input: { readonly code: string; readonly intakeItemId: IntakeId; readonly reason: string },
  user: unknown,
): Promise<void> => {
  const item = await loadIntake(payload, input.intakeItemId)
  const tenantId = idOf(item.tenant)
  if (tenantId === null) throw new IntakeError("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  requireService(user, tenantId)
  if (item.status !== "new" && item.status !== "fetching" && item.status !== "failed") {
    throw new IntakeError("INTAKE_FETCH_STATE_INVALID", String(item.status))
  }
  await payload.update({
    collection: "intake-items",
    data: {
      failureCode: input.code.slice(0, 120),
      failureReason: input.reason.slice(0, 500),
      status: "failed",
    },
    depth: 0,
    draft: true,
    id: item.id,
    overrideAccess: true,
  })
}

export type RssIntakeEntry = Readonly<{
  readonly sourceUrl: string
  readonly summary?: string
  readonly title: string
}>

/**
 * Turns a bounded RSS feed result into normal URL intake work owned by the same
 * connector. Entries whose normalized URL already exists in the tenant are
 * skipped entirely so scheduled re-polls never accumulate duplicate rows.
 */
export const createRssIntakeEntries = async (
  payload: Payload,
  input: { readonly entries: readonly RssIntakeEntry[]; readonly intakeItemId: IntakeId },
  user: unknown,
): Promise<readonly IntakeId[]> => {
  const parent = await loadIntake(payload, input.intakeItemId)
  const tenantId = idOf(parent.tenant)
  const connectorId = idOf(parent.connector)
  if (tenantId === null || connectorId === null) throw new IntakeError("INTAKE_CONNECTOR_REQUIRED")
  requireService(user, tenantId)
  if (parent.channel !== "rss") throw new IntakeError("INTAKE_FETCH_CHANNEL_INVALID", String(parent.channel))
  const suggestedSiteId = idOf(parent.suggestedSite)
  const bounded = input.entries.slice(0, 20)
  const normalizedUrls = [
    ...new Set(bounded.flatMap((entry) => normalizeIntakeUrl(entry.sourceUrl) ?? [])),
  ]
  const knownUrls = new Set(
    normalizedUrls.length === 0
      ? []
      : (
          await payload.find({
            collection: "intake-items",
            depth: 0,
            limit: 100,
            overrideAccess: true,
            where: {
              and: [
                { tenant: { equals: tenantId } },
                { normalizedUrl: { in: normalizedUrls } },
              ],
            },
          })
        ).docs.flatMap((row) => {
          const value = (row as unknown as Record<string, unknown>)["normalizedUrl"]
          return typeof value === "string" ? [value] : []
        }),
  )
  const created: IntakeId[] = []
  for (const entry of bounded) {
    const normalizedUrl = normalizeIntakeUrl(entry.sourceUrl)
    if (normalizedUrl !== undefined && knownUrls.has(normalizedUrl)) continue
    const item = await createIntakeItem(
      payload,
      {
        channel: "url",
        connectorId,
        sourceUrl: entry.sourceUrl,
        ...(suggestedSiteId === null ? {} : { suggestedSiteId }),
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        tenantId,
        title: entry.title,
      },
      user,
    )
    if (item.duplicates.length === 0) {
      created.push(item.intakeItem.id)
      if (normalizedUrl !== undefined) knownUrls.add(normalizedUrl)
    }
  }
  return created
}

import { createHash } from "node:crypto"
import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { createDraftFromPublished } from "./edition-workflow"

export class PerformanceSnapshotsError extends Error {
  override readonly name = "PerformanceSnapshotsError"
  constructor(readonly code: string) { super(code) }
}

const fail = (code: string): PerformanceSnapshotsError => new PerformanceSnapshotsError(code)
const idOf = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
const instant = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) throw fail("PERFORMANCE_SNAPSHOT_INSTANT_INVALID")
  return value
}

export type PerformanceImportRow = Readonly<{
  city?: string
  editionId?: number
  engagement?: number
  observedAt: string
  source: string
  url: string
  visits?: number
  conversions?: number
}>

export const importPerformanceSnapshots = async (
  payload: Payload,
  input: { readonly rows: readonly PerformanceImportRow[]; readonly siteId: number; readonly user: unknown },
): Promise<{ readonly created: number; readonly replayed: number }> => {
  const claims = resolveSessionClaims(input.user)
  if (claims === null || (claims.role !== "tenant-admin" && claims.role !== "super-admin")) throw fail("PERFORMANCE_SNAPSHOT_IMPORTER_REQUIRED")
  const site = await payload.findByID({ collection: "sites", depth: 0, id: input.siteId, overrideAccess: true }).catch(() => null)
  const tenantId = site === null ? null : idOf(site.tenant)
  if (tenantId === null || (claims.role !== "super-admin" && String(claims.tenantId) !== String(tenantId))) throw fail("PERFORMANCE_SNAPSHOT_SITE_NOT_FOUND")
  let created = 0
  let replayed = 0
  for (const row of input.rows.slice(0, 1000)) {
    const observedAt = instant(row.observedAt)
    if (row.source.trim().length === 0 || row.url.trim().length === 0) throw fail("PERFORMANCE_SNAPSHOT_ROW_INVALID")
    const importHash = createHash("sha256").update(JSON.stringify({ ...row, observedAt, siteId: input.siteId })).digest("hex")
    const existing = await payload.find({ collection: "performance-snapshots", depth: 0, limit: 1, overrideAccess: true, where: { importHash: { equals: importHash } } })
    if (existing.docs.length > 0) { replayed += 1; continue }
    await payload.create({
      collection: "performance-snapshots",
      data: {
        ...(row.city === undefined || row.city.trim().length === 0 ? {} : { city: row.city.trim() }),
        ...(row.conversions === undefined ? {} : { conversions: row.conversions }),
        ...(row.editionId === undefined ? {} : { edition: row.editionId }),
        ...(row.engagement === undefined ? {} : { engagement: row.engagement }),
        importHash,
        observedAt,
        site: input.siteId,
        source: row.source.trim(),
        tenant: tenantId,
        url: row.url.trim(),
        ...(row.visits === undefined ? {} : { visits: row.visits }),
      },
      depth: 0,
      overrideAccess: true,
    })
    created += 1
  }
  return { created, replayed }
}

export const performanceSuggestions = async (payload: Payload, user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.tenantId === null) throw fail("PERFORMANCE_SNAPSHOT_UNAUTHENTICATED")
  const snapshots = await payload.find({ collection: "performance-snapshots", depth: 0, limit: 1000, overrideAccess: false, sort: "-observedAt", user })
  const byEdition = new Map<number, { latest?: number; prior?: number }>()
  for (const snapshot of snapshots.docs) {
    const editionId = idOf(snapshot.edition)
    if (editionId === null || typeof snapshot.visits !== "number") continue
    const pair = byEdition.get(editionId) ?? {}
    if (pair.latest === undefined) pair.latest = snapshot.visits
    else if (pair.prior === undefined) pair.prior = snapshot.visits
    byEdition.set(editionId, pair)
  }
  const suggestions = [] as { editionId: number; reason: "traffic-decline"; visits: { current: number; previous: number } }[]
  for (const [editionId, pair] of byEdition) {
    if (pair.latest === undefined || pair.prior === undefined || pair.latest >= pair.prior * 0.7) continue
    const edition = await payload
      .findByID({ collection: "content-editions", depth: 0, id: editionId, overrideAccess: false, user })
      .catch(() => null)
    if (edition?.workflowStatus !== "published") continue
    suggestions.push({ editionId, reason: "traffic-decline", visits: { current: pair.latest, previous: pair.prior } })
  }
  return suggestions
}

export const acceptPerformanceSuggestion = async (payload: Payload, input: { readonly editionId: number; readonly user: unknown }) => {
  await createDraftFromPublished(payload, input.editionId, input.user, "performance refresh suggestion")
  return { editionId: input.editionId, createdDraft: true }
}

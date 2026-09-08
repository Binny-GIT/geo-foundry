import { createHash } from "node:crypto"
import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { createDraftFromPublished } from "./edition-workflow"

export class PerformanceSnapshotsError extends Error {
  override readonly name = "PerformanceSnapshotsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): PerformanceSnapshotsError => new PerformanceSnapshotsError(code)
const idOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
const instant = (value: string): string => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw fail("PERFORMANCE_SNAPSHOT_INSTANT_INVALID")
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


export const performanceSuggestions = async (payload: Payload, user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.tenantId === null)
    throw fail("PERFORMANCE_SNAPSHOT_UNAUTHENTICATED")
  const snapshots = await payload.find({
    collection: "performance-snapshots",
    depth: 0,
    limit: 1000,
    overrideAccess: false,
    sort: "-observedAt",
    user,
  })
  const byEdition = new Map<number, { latest?: number; prior?: number }>()
  for (const snapshot of snapshots.docs) {
    const editionId = idOf(snapshot.edition)
    if (editionId === null || typeof snapshot.visits !== "number") continue
    const pair = byEdition.get(editionId) ?? {}
    if (pair.latest === undefined) pair.latest = snapshot.visits
    else if (pair.prior === undefined) pair.prior = snapshot.visits
    byEdition.set(editionId, pair)
  }
  const suggestions = [] as {
    editionId: number
    reason: "traffic-decline"
    visits: { current: number; previous: number }
  }[]
  for (const [editionId, pair] of byEdition) {
    if (pair.latest === undefined || pair.prior === undefined || pair.latest >= pair.prior * 0.7)
      continue
    const edition = await payload
      .findByID({
        collection: "content-editions",
        depth: 0,
        id: editionId,
        overrideAccess: false,
        user,
      })
      .catch(() => null)
    if (edition?.workflowStatus !== "published") continue
    suggestions.push({
      editionId,
      reason: "traffic-decline",
      visits: { current: pair.latest, previous: pair.prior },
    })
  }
  return suggestions
}


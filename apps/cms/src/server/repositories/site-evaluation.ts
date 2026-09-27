import { and, desc, eq, inArray, sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { operations } from "../db/ledger-schema"
import { qualityAssessments } from "../db/session-schema"

export type SiteEvaluationDb = ServerDb | Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

export const latestSiteAddEvaluation = async (
  db: SiteEvaluationDb,
  editionId: number,
  siteId: number,
) => {
  const rows = await db
    .select({ operationId: operations.operationId, result: operations.result, state: operations.state })
    .from(operations)
    .where(
      and(
        eq(operations.siteId, siteId),
        eq(operations.endpoint, `/editions/${editionId}/sites/${siteId}/evaluate`),
        sql`${operations.targetIds} ->> 'editionId' = ${String(editionId)}`,
      ),
    )
    .orderBy(desc(operations.id))
    .limit(1)
  return rows[0] ?? null
}

export const passedSiteAddAssessmentId = async (
  db: SiteEvaluationDb,
  editionId: number,
  siteId: number,
): Promise<{ readonly addOperationExists: boolean; readonly assessmentId: number | null }> => {
  const latest = await latestSiteAddEvaluation(db, editionId, siteId)
  if (latest === null) return { addOperationExists: false, assessmentId: null }
  if (latest.state !== "succeeded") return { addOperationExists: true, assessmentId: null }
  const result = latest.result
  const ids =
    result !== null && typeof result === "object" && !Array.isArray(result)
      ? (result as { assessmentIds?: unknown }).assessmentIds
      : null
  const assessmentIds = Array.isArray(ids)
    ? ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
    : []
  if (assessmentIds.length === 0) return { addOperationExists: true, assessmentId: null }
  const rows = await db
    .select({ id: qualityAssessments.id })
    .from(qualityAssessments)
    .where(
      and(
        eq(qualityAssessments.editionId, editionId),
        eq(qualityAssessments.siteId, siteId),
        eq(qualityAssessments.state, "passed"),
        inArray(qualityAssessments.id, assessmentIds),
      ),
    )
    .limit(1)
  return { addOperationExists: true, assessmentId: rows[0]?.id ?? null }
}

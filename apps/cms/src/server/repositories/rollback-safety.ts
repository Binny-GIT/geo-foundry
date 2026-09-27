import { and, desc, eq, like } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { operations } from "../db/ledger-schema"
import { releases } from "../db/session-schema"

export type RollbackSafetyDb = ServerDb | Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

export const targetPredatesSiteTakedown = async (
  db: RollbackSafetyDb,
  siteId: number,
  tenantId: number,
  targetReleaseId: string,
): Promise<boolean> => {
  const targets = await db
    .select({ id: releases.id })
    .from(releases)
    .where(
      and(
        eq(releases.releaseId, targetReleaseId),
        eq(releases.siteId, siteId),
        eq(releases.tenantId, tenantId),
      ),
    )
    .limit(1)
  const target = targets[0]
  if (target === undefined) return true
  const takedowns = await db
    .select({ operationId: operations.operationId })
    .from(operations)
    .where(
      and(
        eq(operations.siteId, siteId),
        eq(operations.tenantId, tenantId),
        eq(operations.operationType, "publish"),
        like(operations.endpoint, `/editions/%/sites/${siteId}/re-release`),
      ),
    )
    .orderBy(desc(operations.id))
    .limit(1)
  const latest = takedowns[0]
  if (latest === undefined) return false
  const takedownRelease = await db
    .select({ id: releases.id })
    .from(releases)
    .where(eq(releases.operationId, latest.operationId))
    .limit(1)
  const boundary = takedownRelease[0]?.id
  return boundary === undefined || target.id < boundary
}

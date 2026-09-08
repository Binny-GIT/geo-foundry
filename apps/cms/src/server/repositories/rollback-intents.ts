/*
 * 回滚意图消费（worker 侧）的 Drizzle 实现：同 operation 重放放行，
 * 其余不匹配一律失败；consumed_at 的 CAS 仲裁并发消费。
 */

import { and, eq, isNull } from "drizzle-orm"

import { resolveSessionClaims } from "../../access/session"
import type { ServerDb } from "../db/client"
import { rollbackIntents } from "../db/session-schema"

export class RollbackIntentError extends Error {
  override readonly name = "RollbackIntentError"
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

export type ConsumeRollbackIntentInput = {
  readonly expectedCurrentManifestSha256: string
  readonly expectedCurrentReleaseId: string
  readonly expectedManifestSha256: string
  readonly operationId: string
  readonly rollbackIntentId: string
  readonly runtimeSiteId: string
  readonly targetReleaseId: string
  readonly user: unknown
}

export const consumeRollbackIntent = async (
  db: ServerDb,
  input: ConsumeRollbackIntentInput,
): Promise<void> => {
  const claims = resolveSessionClaims(input.user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw new RollbackIntentError("ROLLBACK_INTENT_SERVICE_REQUIRED", "content-service identity")
  }
  const tenantId = Number(claims.tenantId)
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(rollbackIntents)
      .where(
        and(
          eq(rollbackIntents.intentId, input.rollbackIntentId),
          eq(rollbackIntents.tenantId, tenantId),
        ),
      )
      .limit(1)
    const intent = rows[0]
    if (intent === undefined) {
      throw new RollbackIntentError("ROLLBACK_INTENT_NOT_FOUND", input.rollbackIntentId)
    }
    const exactMatch =
      intent.runtimeSiteId === input.runtimeSiteId &&
      intent.targetReleaseId === input.targetReleaseId &&
      intent.expectedManifestSha256 === input.expectedManifestSha256 &&
      intent.expectedCurrentReleaseId === input.expectedCurrentReleaseId &&
      intent.expectedCurrentManifestSha256 === input.expectedCurrentManifestSha256
    if (!exactMatch || claims.tenantId === null || intent.tenantId !== tenantId) {
      throw new RollbackIntentError("ROLLBACK_INTENT_MISMATCH", input.rollbackIntentId)
    }
    if (
      intent.operationId !== null &&
      intent.operationId.length > 0 &&
      intent.operationId !== input.operationId
    ) {
      throw new RollbackIntentError("ROLLBACK_INTENT_MISMATCH", input.rollbackIntentId)
    }
    if (intent.consumedAt !== null) return
    const updated = await tx
      .update(rollbackIntents)
      .set({ consumedAt: new Date(), operationId: input.operationId, updatedAt: new Date() })
      .where(and(eq(rollbackIntents.id, intent.id), isNull(rollbackIntents.consumedAt)))
      .returning({ id: rollbackIntents.id })
    if (updated.length !== 1) {
      throw new RollbackIntentError("ROLLBACK_INTENT_ALREADY_CONSUMED", input.rollbackIntentId)
    }
  })
}

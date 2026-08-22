import type { Payload } from "payload"
import { resolveSessionClaims } from "../access/session"
import { runOutboxScopedTransaction, type TransactionScope } from "../outbox/outbox"

export class RollbackIntentError extends Error {
  override readonly name = "RollbackIntentError"

  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

type IntentDoc = {
  readonly approvedBy: unknown
  readonly consumedAt: unknown
  readonly expectedManifestSha256: unknown
  readonly expectedCurrentManifestSha256: unknown
  readonly expectedCurrentReleaseId: unknown
  readonly id: number
  readonly intentId: unknown
  readonly operationId: unknown
  readonly runtimeSiteId: unknown
  readonly site: unknown
  readonly targetReleaseId: unknown
  readonly tenant: unknown
}

type IntentStore = {
  find(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
  update(options: Record<string, unknown>): Promise<{ readonly docs: readonly unknown[] }>
}

const storeOf = (payload: Payload): IntentStore => payload as unknown as IntentStore
const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null
const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

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

/**
 * Consumes exactly one publisher-approved intent for its matching rollback
 * operation. Replays by the same operation are accepted; every other service
 * submission fails before it can reach object-storage CAS.
 */
export const consumeRollbackIntent = async (
  payload: Payload,
  input: ConsumeRollbackIntentInput,
): Promise<void> => {
  const claims = resolveSessionClaims(input.user)
  if (claims === null || claims.kind !== "service" || claims.role !== "content-service") {
    throw new RollbackIntentError("ROLLBACK_INTENT_SERVICE_REQUIRED", "content-service identity")
  }
  await runOutboxScopedTransaction(payload, async (req: TransactionScope) => {
    const found = await storeOf(payload).find({
      collection: "rollback-intents",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: {
        and: [
          { intentId: { equals: input.rollbackIntentId } },
          { tenant: { equals: claims.tenantId } },
        ],
      },
    })
    const intent = (found.docs[0] as IntentDoc | undefined) ?? null
    if (intent === null) {
      throw new RollbackIntentError("ROLLBACK_INTENT_NOT_FOUND", input.rollbackIntentId)
    }
    const tenantId = numberOf(intent.tenant)
    const exactMatch =
      textOf(intent.runtimeSiteId) === input.runtimeSiteId &&
      textOf(intent.targetReleaseId) === input.targetReleaseId &&
      textOf(intent.expectedManifestSha256) === input.expectedManifestSha256 &&
      textOf(intent.expectedCurrentReleaseId) === input.expectedCurrentReleaseId &&
      textOf(intent.expectedCurrentManifestSha256) === input.expectedCurrentManifestSha256
    if (!exactMatch || claims.tenantId === null || String(claims.tenantId) !== String(tenantId)) {
      throw new RollbackIntentError("ROLLBACK_INTENT_MISMATCH", input.rollbackIntentId)
    }
    const consumedBy = textOf(intent.operationId)
    if (
      intent.consumedAt !== null &&
      intent.consumedAt !== undefined &&
      consumedBy !== input.operationId
    ) {
      throw new RollbackIntentError("ROLLBACK_INTENT_ALREADY_CONSUMED", input.rollbackIntentId)
    }
    if (consumedBy === input.operationId) {
      return
    }
    const updated = await storeOf(payload).update({
      collection: "rollback-intents",
      data: { consumedAt: new Date().toISOString(), operationId: input.operationId },
      depth: 0,
      overrideAccess: true,
      req,
      where: {
        and: [{ id: { equals: intent.id } }, { consumedAt: { exists: false } }],
      },
    })
    if (updated.docs.length !== 1) {
      throw new RollbackIntentError("ROLLBACK_INTENT_ALREADY_CONSUMED", input.rollbackIntentId)
    }
  })
}

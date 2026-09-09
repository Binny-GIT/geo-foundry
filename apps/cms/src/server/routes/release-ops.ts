/*
 * 控制面操作路由：回滚意图创建 + editor 评估操作提交。
 * 两者都以 operation、idempotency 与任务入队同事务落账（评估复用
 * OperationsRepository；回滚为保持与 intent 插入同事务，内联同构逻辑）。
 */

import { createHash, randomUUID } from "node:crypto"

import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import { operationRequestHashOf, operationUniqueKeyOf } from "../../services/operations-ledger"
import { authenticateRequest } from "../auth/session"
import { sites } from "../db/entity-schema"
import { idempotencyRecords, operations } from "../db/ledger-schema"
import { releases, rollbackIntents } from "../db/session-schema"
import { sendOperationJobWithin } from "../jobs/pgboss"
import { entityScopeOf } from "../repositories/entities"
import { OperationsRepository } from "../repositories/operations"
import { serverRuntime } from "../runtime"

export class ReleaseOpsError extends Error {
  override readonly name = "ReleaseOpsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex")

const json = (status: number, body: unknown, requestId?: string): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(requestId === undefined ? {} : { "x-request-id": requestId }),
    },
    status,
  })

const rollbackSchema = z
  .object({
    expectedCurrentManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    expectedCurrentReleaseId: z.string().min(1).max(128),
    expectedManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().min(1).max(500).optional(),
    siteId: z.number().int().positive(),
    targetReleaseId: z.string().min(1).max(128),
  })
  .strict()

const evaluationSchema = z
  .object({
    thresholds: z
      .object({ dimensionMin: z.number().min(0).max(100), overallMin: z.number().min(0).max(100) })
      .strict()
      .optional(),
  })
  .strict()

export const rollbackIntentRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 2 && slug[0] === "rollback-operations" && slug[1] === "intents"

export const evaluationRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 5 &&
  slug[0] === "workspaces" &&
  slug[1] === "editor" &&
  slug[2] === "editions" &&
  slug[4] === "evaluation-operations"

export const handleRollbackIntentPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!rollbackIntentRouteOf(slug)) return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "ROLLBACK_UNAUTHENTICATED" } })
  if (auth.claims.role !== "publisher") {
    return json(403, { error: { code: "ROLLBACK_PUBLISHER_REQUIRED" } })
  }
  const tenantId = auth.claims.tenantId === null ? null : Number(auth.claims.tenantId)
  if (tenantId === null || tenantId <= 0) {
    return json(403, { error: { code: "ROLLBACK_TENANT_MISMATCH" } })
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "ROLLBACK_BODY_INVALID" } })
  }
  const parsed = rollbackSchema.safeParse(raw)
  if (!parsed.success) return json(400, { error: { code: "ROLLBACK_BODY_INVALID" } })
  const input = parsed.data
  const errorStatus = (code: string): number =>
    code === "ROLLBACK_PUBLISHER_REQUIRED" || code === "ROLLBACK_TENANT_MISMATCH"
      ? 403
      : code === "ROLLBACK_SITE_NOT_FOUND" || code === "ROLLBACK_RELEASE_NOT_FOUND"
        ? 404
        : 409
  try {
    const result = await serverRuntime().db.transaction(async (tx) => {
      const siteRows = await tx
        .select({ id: sites.id, tenantId: sites.tenantId })
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1)
      const site = siteRows[0]
      if (site === undefined) throw new ReleaseOpsError("ROLLBACK_SITE_NOT_FOUND")
      if (site.tenantId !== tenantId) throw new ReleaseOpsError("ROLLBACK_TENANT_MISMATCH")
      const runtimeSiteId = `site-${site.id}`
      const releaseRows = await tx
        .select()
        .from(releases)
        .where(
          sql`${releases.releaseId} IN (${input.expectedCurrentReleaseId}, ${input.targetReleaseId})`,
        )
      const source = releaseRows.find((row) => row.releaseId === input.expectedCurrentReleaseId)
      const target = releaseRows.find((row) => row.releaseId === input.targetReleaseId)
      if (source === undefined || target === undefined) {
        throw new ReleaseOpsError("ROLLBACK_RELEASE_NOT_FOUND")
      }
      const matchesSite = (row: typeof source): boolean =>
        row.siteId === site.id && row.tenantId === tenantId && row.runtimeSiteId === runtimeSiteId
      if (!matchesSite(source) || !matchesSite(target)) {
        throw new ReleaseOpsError("ROLLBACK_RELEASE_SITE_MISMATCH")
      }
      if (
        source.state !== "current" ||
        source.manifestSha256 !== input.expectedCurrentManifestSha256 ||
        target.manifestSha256 !== input.expectedManifestSha256 ||
        source.releaseId === target.releaseId
      ) {
        throw new ReleaseOpsError("ROLLBACK_RELEASE_STATE_MISMATCH")
      }
      const intentId = randomUUID()
      const operationId = randomUUID()
      const endpoint = `/rollback-intents/${intentId}/execute`
      const idempotencyKey = `rollback-intent-${intentId}`
      const requestPayload = {
        body: {
          expectedCurrentManifestSha256: input.expectedCurrentManifestSha256,
          expectedCurrentReleaseId: input.expectedCurrentReleaseId,
          expectedManifestSha256: input.expectedManifestSha256,
          rollbackIntentId: intentId,
          siteId: runtimeSiteId,
          targetReleaseId: input.targetReleaseId,
        },
      }
      const requestHash = sha256(JSON.stringify(requestPayload))
      const uniqueKey = sha256(`${tenantId}\n${endpoint}\n${idempotencyKey}`)
      const actor = {
        kind: "user",
        role: auth.claims.role,
        tenantId,
        userId: auth.claims.userId,
      }
      await tx.insert(rollbackIntents).values({
        approvedBy: actor,
        expectedCurrentManifestSha256: input.expectedCurrentManifestSha256,
        expectedCurrentReleaseId: input.expectedCurrentReleaseId,
        expectedManifestSha256: input.expectedManifestSha256,
        fromManifestSha256: input.expectedCurrentManifestSha256,
        fromReleaseId: input.expectedCurrentReleaseId,
        intentId,
        operationId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        runtimeSiteId,
        siteId: site.id,
        targetReleaseId: input.targetReleaseId,
        tenantId,
      })
      await tx.insert(operations).values({
        auditLog: [
          {
            action: "operation.created",
            actor,
            at: new Date().toISOString(),
            detail: { endpoint, requestHash },
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
        ],
        attempt: 1,
        endpoint,
        error: null,
        idempotencyKeyHash: sha256(idempotencyKey),
        operationId,
        operationType: "rollback",
        requestPayload,
        revision: 0,
        result: null,
        siteId: site.id,
        state: "queued",
        targetIds: { siteId: site.id },
        tenantId,
      })
      await tx.insert(idempotencyRecords).values({
        endpoint,
        idempotencyKey,
        operationId,
        replayCount: 0,
        requestHash,
        tenantId,
        uniqueKey,
      })
      await sendOperationJobWithin(tx, {
        kind: "operation",
        operationId,
        operationType: "rollback",
        payload: (requestPayload["body"] ?? {}) as Record<string, unknown>,
        tenantId,
      })
      return { intentId, operationId, runtimeSiteId }
    })
    return json(201, result)
  } catch (error) {
    const code = error instanceof ReleaseOpsError ? error.code : "ROLLBACK_FAILED"
    return json(errorStatus(code), { error: { code } })
  }
}

export const handleEvaluationPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!evaluationRouteOf(slug)) return null
  const editionId = slug?.[3] !== undefined && /^\d+$/.test(slug[3]) ? Number(slug[3]) : null
  if (editionId === null || editionId <= 0) {
    return json(400, { error: { code: "EDITION_EVALUATION_ID_INVALID" } })
  }
  const requestId = request.headers.get("x-request-id")
  const resolvedRequestId = requestId === null ? randomUUID() : requestId
  if (requestId !== null && !/^[A-Za-z0-9._-]{8,64}$/.test(requestId)) {
    return json(400, { error: { code: "EDITION_EVALUATION_REQUEST_ID_INVALID" } }, randomUUID())
  }
  const idempotencyKey = request.headers.get("idempotency-key")
  if (idempotencyKey === null || !/^[A-Za-z0-9._-]{8,128}$/.test(idempotencyKey)) {
    return json(
      400,
      { error: { code: "EDITION_EVALUATION_IDEMPOTENCY_KEY_INVALID" } },
      resolvedRequestId,
    )
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) {
    return json(401, { error: { code: "EDITION_EVALUATION_UNAUTHENTICATED" } }, resolvedRequestId)
  }
  const role = auth.claims.role
  const scope = entityScopeOf(auth)
  if (scope === null || (role !== "editor" && role !== "super-admin")) {
    return json(403, { error: { code: "EDITION_WORKFLOW_EDITOR_REQUIRED" } }, resolvedRequestId)
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "EDITION_EVALUATION_BODY_INVALID" } }, resolvedRequestId)
  }
  const parsed = evaluationSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return json(400, { error: { code: "EDITION_EVALUATION_BODY_INVALID" } }, resolvedRequestId)
  }
  const requestedThresholds = parsed.data.thresholds
  const db = serverRuntime().db
  const { EditionsRepository } = await import("../repositories/editions")
  const document = await new EditionsRepository(db).findDraft(scope, editionId)
  if (document === null) {
    return json(404, { error: { code: "EDITION_EVALUATION_NOT_FOUND" } }, resolvedRequestId)
  }
  const workflowStatus = String(document["workflowStatus"] ?? "")
  if (
    workflowStatus !== "draft" &&
    workflowStatus !== "generating" &&
    workflowStatus !== "review"
  ) {
    return json(
      409,
      { error: { code: "EDITION_WORKFLOW_EVALUATION_NOT_ALLOWED" } },
      resolvedRequestId,
    )
  }
  const tenantId = scope.kind === "global" ? Number(document["tenant"] ?? -1) : scope.tenantId
  const siteIdRaw = document["site"]
  const siteId = typeof siteIdRaw === "number" ? siteIdRaw : undefined
  const siteThresholds =
    siteId === undefined
      ? null
      : (
          await db
            .select({
              dimensionMin: sites.qualityThresholdsDimensionMinimum,
              overallMin: sites.qualityThresholdsOverallMinimum,
            })
            .from(sites)
            .where(eq(sites.id, siteId))
            .limit(1)
        )[0]
  const thresholds =
    requestedThresholds ??
    (siteThresholds === undefined || siteThresholds === null
      ? undefined
      : {
          dimensionMin: Number(siteThresholds.dimensionMin ?? 75),
          overallMin: Number(siteThresholds.overallMin ?? 80),
        })
  const endpoint = `/workspaces/editor/editions/${editionId}/evaluation/revision-${Number(document["workflowRevision"] ?? 0)}`
  const requestPayload = {
    body: {
      editionId,
      ...(thresholds === undefined ? {} : { thresholds }),
    },
  }
  try {
    const outcome = await new OperationsRepository(db).submit({
      auditLog: [
        {
          action: "operation.created",
          actor: { kind: "user", role, tenantId, userId: auth.claims.userId },
          at: new Date().toISOString(),
          detail: { endpoint, requestHash: operationRequestHashOf(requestPayload) },
        },
      ],
      endpoint,
      idempotencyKey,
      idempotencyKeyHash: sha256(idempotencyKey),
      operationId: randomUUID(),
      operationType: "evaluate",
      requestHash: operationRequestHashOf(requestPayload),
      requestPayload,
      ...(siteId === undefined ? {} : { siteId }),
      targetIds: { editionId },
      tenantId,
      uniqueKey: operationUniqueKeyOf(tenantId, endpoint, idempotencyKey),
      outbox: {
        aggregateId: editionId,
        eventPayload: requestPayload,
        requestId: resolvedRequestId,
        type: "evaluation.requested",
      },
    })
    return json(
      outcome.created ? 202 : 200,
      {
        created: outcome.created,
        editionId,
        operation: {
          attempt: 1,
          currentStage: null,
          endpoint,
          error: null,
          operationId: outcome.operationId,
          operationType: "evaluate",
          revision: 0,
          result: null,
          state: outcome.state,
        },
      },
      resolvedRequestId,
    )
  } catch {
    return json(409, { error: { code: "IDEMPOTENCY_KEY_REUSED" } }, resolvedRequestId)
  }
}

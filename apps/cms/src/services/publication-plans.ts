import { validateTimezone } from "@geo/domain"
import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"
import { runOutboxScopedTransaction } from "../outbox/outbox"
import { assertEditionTenantScope, EditionWorkflowError, loadWorkflowEdition } from "./edition-workflow"
import { getOperation, submitEditionPublishOperation } from "./operations-ledger"

export class PublicationPlansError extends Error {
  override readonly name = "PublicationPlansError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail?: string): PublicationPlansError =>
  new PublicationPlansError(code, detail)

const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null

const revisionOf = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0

const CLAIM_LEASE_MS = 30_000

const instantOf = (value: string): string => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw fail("PUBLICATION_PLAN_INSTANT_INVALID")
  }
  return value
}

const docOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const updatePlan = async (
  payload: Payload,
  plan: Record<string, unknown>,
  data: Record<string, unknown>,
  expectedStatus: "pending" | "running",
): Promise<boolean> => {
  const id = numberOf(plan["id"])
  if (id === null) return false
  const revision = revisionOf(plan["revision"])
  const updated = await payload.update({
    collection: "publication-plans",
    data: { ...data, revision: revision + 1 },
    depth: 0,
    overrideAccess: true,
    where: {
      and: [
        { id: { equals: id } },
        { revision: { equals: revision } },
        { status: { equals: expectedStatus } },
      ],
    },
  })
  return updated.docs.length === 1
}

export const createPublicationPlan = async (
  payload: Payload,
  input: {
    readonly editionId: number
    readonly scheduledFor: string
    readonly timezone: string
    readonly user: unknown
  },
): Promise<{ readonly planId: string; readonly status: "pending" }> => {
  const scheduledFor = instantOf(input.scheduledFor)
  const timezone = validateTimezone(input.timezone)
  if (!timezone.ok) throw fail("PUBLICATION_PLAN_TIMEZONE_INVALID")
  return runOutboxScopedTransaction(payload, async (req) => {
    const edition = await loadWorkflowEdition(payload, input.editionId, req, true)
    const claims = assertEditionTenantScope(input.user, edition)
    if (claims.role !== "publisher") {
      throw new EditionWorkflowError("EDITION_WORKFLOW_PUBLISHER_REQUIRED", "publication plan")
    }
    if (edition.workflowStatus !== "approved" && edition.workflowStatus !== "compiled") {
      throw fail("PUBLICATION_PLAN_EDITION_NOT_READY", String(edition.workflowStatus))
    }
    const siteId = numberOf(edition.site)
    if (siteId === null) throw fail("PUBLICATION_PLAN_SITE_INVALID")
    const site = await payload.findByID({ collection: "sites", depth: 0, id: siteId, overrideAccess: true, req })
    if (
      numberOf(site.tenant) !== numberOf(edition.tenant) ||
      site.timezone !== timezone.value.value
    ) {
      throw fail("PUBLICATION_PLAN_TIMEZONE_MISMATCH")
    }
    const planId = crypto.randomUUID()
    await payload.create({
      collection: "publication-plans",
      data: {
        edition: input.editionId,
        planId,
        requestedBy: Number(claims.userId),
        scheduledFor,
        site: siteId,
        tenant: numberOf(edition.tenant) ?? -1,
        timezone: timezone.value.value,
      },
      depth: 0,
      draft: true,
      overrideAccess: true,
      req,
    })
    return { planId, status: "pending" }
  })
}

export const cancelPublicationPlan = async (
  payload: Payload,
  input: { readonly planId: string; readonly user: unknown },
): Promise<void> => {
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    (claims.role !== "publisher" && claims.role !== "tenant-admin" && claims.role !== "super-admin")
  ) {
    throw fail("PUBLICATION_PLAN_PUBLISHER_REQUIRED")
  }
  const found = await payload.find({
    collection: "publication-plans",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { planId: { equals: input.planId } },
  })
  const plan = docOf(found.docs[0])
  const tenantId = numberOf(plan["tenant"])
  if (tenantId === null || (claims.role !== "super-admin" && String(claims.tenantId) !== String(tenantId))) {
    throw fail("PUBLICATION_PLAN_NOT_FOUND")
  }
  if (!(await updatePlan(payload, plan, { status: "cancelled" }, "pending"))) {
    throw fail("PUBLICATION_PLAN_NOT_CANCELLABLE")
  }
}

export type DuePublicationPlan = Readonly<{
  operationId: string
  planId: string
}>

const resumableClaim = (plan: Record<string, unknown>, now: string): boolean => {
  const claimedAt = typeof plan["claimedAt"] === "string" ? Date.parse(plan["claimedAt"]) : Number.NaN
  return Number.isNaN(claimedAt) || claimedAt + CLAIM_LEASE_MS <= Date.parse(now)
}

const settleRunningPlans = async (
  payload: Payload,
  now: string,
  tenantId: number,
  user: unknown,
): Promise<void> => {
  const running = await payload.find({
    collection: "publication-plans",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { and: [{ status: { equals: "running" } }, { tenant: { equals: tenantId } }] },
  })
  for (const raw of running.docs) {
    const plan = docOf(raw)
    const operationId = typeof plan["operationId"] === "string" ? plan["operationId"] : null
    if (operationId === null) continue
    const operation = await getOperation(payload, operationId, user).catch(() => null)
    if (
      operation === null ||
      (operation.state !== "succeeded" && operation.state !== "failed" && operation.state !== "cancelled")
    ) {
      continue
    }
    const status = operation.state === "succeeded" ? "succeeded" : "failed"
    await updatePlan(
      payload,
      plan,
      {
        ...(status === "succeeded"
          ? {
              publishedAt: now,
              releaseId:
                typeof operation.result?.["releaseId"] === "string"
                  ? operation.result["releaseId"]
                  : null,
            }
          : { lastError: String(operation.error?.["code"] ?? operation.state) }),
        status,
      },
      "running",
    )
  }
}

const attachPublishOperation = async (
  payload: Payload,
  plan: Record<string, unknown>,
): Promise<DuePublicationPlan | null> => {
  const requestedById = numberOf(plan["requestedBy"])
  const editionId = numberOf(plan["edition"])
  const planId = typeof plan["planId"] === "string" ? plan["planId"] : null
  if (requestedById === null || editionId === null || planId === null) {
    return null
  }
  const publisher = await payload
    .findByID({ collection: "users", depth: 0, id: requestedById, overrideAccess: true })
    .catch(() => null)
  if (publisher === null) {
    await updatePlan(payload, plan, { lastError: "PUBLICATION_PLAN_REQUESTER_NOT_FOUND", status: "failed" }, "running")
    return null
  }
  try {
    const outcome = await submitEditionPublishOperation(payload, {
      editionId,
      reason: `Scheduled publication ${planId}`,
      user: publisher,
    })
    const attached = await updatePlan(payload, plan, { operationId: outcome.operationId }, "running")
    return attached ? { operationId: outcome.operationId, planId } : null
  } catch (error) {
    const code = error instanceof Error ? error.message : "PUBLICATION_PLAN_OPERATION_FAILED"
    await updatePlan(payload, plan, { lastError: code.slice(0, 500), status: "failed" }, "running")
    return null
  }
}

/**
 * Worker-side dispatch. Plans are first moved from pending to running through
 * revision CAS, then their publisher-authorized operation is created/replayed.
 * If a Worker crashes between those steps, a later loop resumes the running
 * plan with no operation ID; operation idempotency remains the cross-process
 * arbiter.
 */
export const dispatchDuePublicationPlans = async (
  payload: Payload,
  input: { readonly now: string; readonly workerId: string; readonly user: unknown },
): Promise<readonly DuePublicationPlan[]> => {
  const now = instantOf(input.now)
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    claims.kind !== "service" ||
    claims.role !== "content-service" ||
    claims.tenantId === null
  ) {
    throw fail("PUBLICATION_PLAN_SERVICE_REQUIRED")
  }
  const tenantId = Number(claims.tenantId)

  await settleRunningPlans(payload, now, tenantId, input.user)
  const runningWithoutOperation = await payload.find({
    collection: "publication-plans",
    depth: 0,
    limit: 20,
    overrideAccess: true,
    where: { and: [{ status: { equals: "running" } }, { tenant: { equals: tenantId } }] },
  })
  const resumed = await Promise.all(
    runningWithoutOperation.docs
      .map(docOf)
      .filter(
        (plan) =>
          typeof plan["operationId"] !== "string" &&
          resumableClaim(plan, now),
      )
      .map(async (plan) => attachPublishOperation(payload, plan)),
  )

  const due = await payload.find({
    collection: "publication-plans",
    depth: 0,
    limit: 20,
    overrideAccess: true,
    sort: "scheduledFor",
    where: {
      and: [
        { status: { equals: "pending" } },
        { tenant: { equals: tenantId } },
        { scheduledFor: { less_than_equal: now } },
      ],
    },
  })
  const claimed: DuePublicationPlan[] = []
  for (const raw of due.docs) {
    const plan = docOf(raw)
    const claim = await updatePlan(
      payload,
      plan,
      {
        attempts: (typeof plan["attempts"] === "number" ? plan["attempts"] : 0) + 1,
        claimedAt: now,
        claimedBy: input.workerId,
        status: "running",
      },
      "pending",
    )
    if (!claim) continue
    const refreshed = await payload.find({
      collection: "publication-plans",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { planId: { equals: plan["planId"] } },
    })
    const attached = await attachPublishOperation(payload, docOf(refreshed.docs[0]))
    if (attached !== null) claimed.push(attached)
  }
  return [...resumed.filter((plan): plan is DuePublicationPlan => plan !== null), ...claimed]
}

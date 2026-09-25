/*
 * 发布计划路由：POST /publication-plan-operations[/:planId/cancel]。
 * create：publisher/super-admin + approved|compiled + 站点时区一致性，
 * 单事务插入计划行；cancel：CAS pending→cancelled。
 */

import { randomUUID } from "node:crypto"

import { validateTimezone } from "@geo/domain"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { authenticateRequest } from "../auth/session"
import { sites } from "../db/entity-schema"
import { publicationPlans } from "../db/session-schema"
import { desiredEditionSiteIdsOf, memberSiteIdsOf } from "../repositories/edition-sites"
import { loadCurrentVersion } from "../repositories/edition-workflow"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

export class PublicationPlanError extends Error {
  override readonly name = "PublicationPlanError"
  constructor(readonly code: string) {
    super(code)
  }
}

const createSchema = z
  .object({
    editionId: z.number().int().positive(),
    scheduledFor: z.string(),
    timezone: z.string().min(1).max(100),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const statusOf = (code: string): number =>
  code === "EDITION_WORKFLOW_PUBLISHER_REQUIRED" || code === "PUBLICATION_PLAN_PUBLISHER_REQUIRED"
    ? 403
    : code === "PUBLICATION_PLAN_NOT_FOUND"
      ? 404
      : code.includes("CONFLICT") || code.includes("CANCELLABLE")
        ? 409
        : 400

const instantOf = (value: string): string => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PublicationPlanError("PUBLICATION_PLAN_INSTANT_INVALID")
  }
  return value
}

export type PublicationPlanRoute = "create" | "cancel"

export const publicationPlanRouteOf = (
  slug: readonly string[] | undefined,
): PublicationPlanRoute | null => {
  if (slug?.length === 1 && slug[0] === "publication-plan-operations") return "create"
  if (slug?.length === 3 && slug[0] === "publication-plan-operations" && slug[2] === "cancel") {
    return "cancel"
  }
  return null
}

export const handlePublicationPlanPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const route = publicationPlanRouteOf(slug)
  if (route === null) return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "PUBLICATION_PLAN_UNAUTHENTICATED" } })
  const role = auth.claims.role
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { error: { code: "PUBLICATION_PLAN_PUBLISHER_REQUIRED" } })
  const db = serverRuntime().db

  try {
    if (route === "create") {
      let raw: unknown
      try {
        raw = await request.json()
      } catch {
        return json(400, { error: { code: "PUBLICATION_PLAN_BODY_INVALID" } })
      }
      const parsed = createSchema.safeParse(raw)
      if (!parsed.success) {
        return json(400, { error: { code: "PUBLICATION_PLAN_BODY_INVALID" } })
      }
      const scheduledFor = instantOf(parsed.data.scheduledFor)
      const timezone = validateTimezone(parsed.data.timezone)
      if (!timezone.ok) throw new PublicationPlanError("PUBLICATION_PLAN_TIMEZONE_INVALID")
      if (role !== "publisher" && role !== "super-admin") {
        throw new PublicationPlanError("EDITION_WORKFLOW_PUBLISHER_REQUIRED")
      }
      // A4 每站一条计划：多站文章的排期为每个成员站点各插一条（A2 起派发
      // 按计划行的站点发布）。单站文章成员集就是 [主站]，行为与旧版一致。
      const plans = await db.transaction(async (tx) => {
        const { version } = await loadCurrentVersion(tx, scope, parsed.data.editionId)
        if (version.workflowStatus !== "approved" && version.workflowStatus !== "compiled") {
          throw new PublicationPlanError("PUBLICATION_PLAN_EDITION_NOT_READY")
        }
        const desired = desiredEditionSiteIdsOf({
          siteId: version.siteId,
          sites: version.sites,
        }).filter((id) => id > 0)
        const memberSites =
          desired.length === 0 ? [] : await memberSiteIdsOf(tx, parsed.data.editionId, desired)
        if (memberSites.length === 0) {
          throw new PublicationPlanError("PUBLICATION_PLAN_SITE_INVALID")
        }
        const siteRows = await tx
          .select({ id: sites.id, tenantId: sites.tenantId, timezone: sites.timezone })
          .from(sites)
          .where(inArray(sites.id, memberSites))
        const siteById = new Map(siteRows.map((row) => [row.id, row]))
        for (const siteId of memberSites) {
          const site = siteById.get(siteId)
          if (
            site === undefined ||
            site.tenantId !== version.tenantId ||
            site.timezone !== timezone.value.value
          ) {
            throw new PublicationPlanError("PUBLICATION_PLAN_TIMEZONE_MISMATCH")
          }
        }
        const created = memberSites.map((siteId) => ({ planId: randomUUID(), siteId }))
        await Promise.all(
          created.map(async (plan) => {
            await tx.insert(publicationPlans).values({
              editionId: parsed.data.editionId,
              planId: plan.planId,
              requestedById: Number(auth.claims.userId),
              scheduledFor: new Date(scheduledFor),
              siteId: plan.siteId,
              tenantId: version.tenantId ?? -1,
              timezone: timezone.value.value,
            })
          }),
        )
        return created.map((plan) => ({
          planId: plan.planId,
          siteId: plan.siteId,
          status: "pending" as const,
        }))
      })
      return json(201, { plans })
    }

    const planId = slug?.[1] ?? ""
    if (!/^[A-Za-z0-9-]{8,128}$/.test(planId)) {
      return json(400, { error: { code: "PUBLICATION_PLAN_ID_INVALID" } })
    }
    if (role !== "publisher" && role !== "tenant-admin" && role !== "super-admin") {
      throw new PublicationPlanError("PUBLICATION_PLAN_PUBLISHER_REQUIRED")
    }
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(publicationPlans)
        .where(eq(publicationPlans.planId, planId))
        .limit(1)
      const plan = rows[0]
      const scopedTenant = scope.kind === "global" ? null : scope.tenantId
      if (plan === undefined || (scopedTenant !== null && plan.tenantId !== scopedTenant)) {
        throw new PublicationPlanError("PUBLICATION_PLAN_NOT_FOUND")
      }
      const updated = await tx
        .update(publicationPlans)
        .set({
          revision: (plan.revision ?? 0) + 1,
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(publicationPlans.id, plan.id),
            eq(publicationPlans.revision, plan.revision ?? 0),
            eq(publicationPlans.status, "pending"),
          ),
        )
        .returning({ id: publicationPlans.id })
      if (updated.length !== 1) throw new PublicationPlanError("PUBLICATION_PLAN_NOT_CANCELLABLE")
    })
    return json(200, { cancelled: true, planId })
  } catch (error) {
    const code = error instanceof PublicationPlanError ? error.code : "PUBLICATION_PLAN_FAILED"
    return json(statusOf(code), { error: { code } })
  }
}
